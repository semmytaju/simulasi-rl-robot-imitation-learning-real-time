/**
 * bc-training-worker.js
 * Dedicated Web Worker for Dual-Head Behavior Cloning supervised training with TensorFlow.js:
 *   1. Policy Classifier: state (12) -> Dense(128 ReLU) -> Dense(64 ReLU) -> Dense(9 Softmax)
 *   2. Continuous Pose Regressor: state (12) -> Dense(96 ReLU) -> Dense(48 ReLU) -> Dense(10 Tanh)
 * Keeps Three.js 60 FPS rendering and webcam pose tracking completely unblocked.
 */
let tfReady = false;
let isCancelled = false;
let activeModel = null;
let activePoseModel = null;

async function ensureTf(tfScriptUrl) {
    if (tfReady && typeof tf !== 'undefined') return true;
    if (typeof tf === 'undefined') {
        try {
            importScripts(tfScriptUrl);
        } catch (e) {
            importScripts('https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.17.0/dist/tf.min.js');
        }
    }
    await tf.setBackend('cpu');
    await tf.ready();
    tfReady = true;
    return true;
}

function buildBehaviorCloningNetwork(stateDim, actionDim, hidden1, hidden2, learningRate) {
    const model = tf.sequential();
    model.add(tf.layers.dense({
        inputShape: [stateDim],
        units: hidden1,
        activation: 'relu',
        kernelInitializer: 'heNormal'
    }));
    model.add(tf.layers.dense({
        units: hidden2,
        activation: 'relu',
        kernelInitializer: 'heNormal'
    }));
    model.add(tf.layers.dense({
        units: actionDim,
        activation: 'softmax',
        kernelInitializer: 'glorotUniform'
    }));

    model.compile({
        optimizer: tf.train.adam(learningRate),
        loss: 'categoricalCrossentropy',
        metrics: ['accuracy']
    });
    return model;
}

function buildPoseRegressorNetwork(stateDim, poseDim, poseLr) {
    const model = tf.sequential();
    model.add(tf.layers.dense({
        inputShape: [stateDim],
        units: 96,
        activation: 'relu',
        kernelInitializer: 'heNormal'
    }));
    model.add(tf.layers.dense({
        units: 48,
        activation: 'relu',
        kernelInitializer: 'heNormal'
    }));
    model.add(tf.layers.dense({
        units: poseDim,
        activation: 'tanh',
        kernelInitializer: 'glorotUniform'
    }));

    model.compile({
        optimizer: tf.train.adam(poseLr),
        loss: 'meanSquaredError'
    });
    return model;
}

function extractSerializableWeights(model) {
    return tf.tidy(() => {
        return model.getWeights().map(w => ({
            shape: w.shape,
            data: Array.from(w.dataSync()).map(v => Number(v.toFixed(6)))
        }));
    });
}

function restoreWeightsFromSerialized(model, serializedWeights) {
    if (!Array.isArray(serializedWeights) || serializedWeights.length === 0) return;
    tf.tidy(() => {
        const tensors = serializedWeights.map(t => tf.tensor(t.data, t.shape));
        model.setWeights(tensors);
    });
}

async function handleStartTraining(msg) {
    isCancelled = false;

    const stateDim = msg.stateDim || 12;
    const actionDim = msg.actionDim || 9;
    const poseDim = msg.poseDim || 10;
    const epochs = Math.max(1, Math.min(300, parseInt(msg.epochs, 10) || 50));
    const batchSize = Math.max(4, Math.min(256, parseInt(msg.batchSize, 10) || 32));
    const learningRate = Math.max(0.00005, Math.min(0.05, parseFloat(msg.learningRate) || 0.001));
    const poseLr = Math.max(0.0001, Math.min(0.05, parseFloat(msg.poseLearningRate) || 0.0015));
    const hidden1 = Math.max(16, Math.min(512, parseInt(msg.hidden1, 10) || 128));
    const hidden2 = Math.max(16, Math.min(256, parseInt(msg.hidden2, 10) || 64));
    const patience = Math.max(3, Math.min(50, parseInt(msg.earlyStoppingPatience, 10) || 12));
    const useClassWeights = msg.useClassWeights !== false;
    const trainPoseHead = Boolean(msg.yPoseTrainBuffer && msg.yPoseValBuffer);

    let xTrainT = null;
    let yTrainT = null;
    let xValT = null;
    let yValT = null;
    let yPoseTrainT = null;
    let yPoseValT = null;

    try {
        await ensureTf(msg.tfScriptUrl);

        if (activeModel) {
            try { activeModel.dispose(); } catch (e) {}
            activeModel = null;
        }
        if (activePoseModel) {
            try { activePoseModel.dispose(); } catch (e) {}
            activePoseModel = null;
        }

        const xTrainArr = new Float32Array(msg.xTrainBuffer);
        const yTrainArr = new Int32Array(msg.yTrainBuffer);
        const xValArr = new Float32Array(msg.xValBuffer);
        const yValArr = new Int32Array(msg.yValBuffer);

        const trainCount = msg.trainCount;
        const valCount = msg.valCount;

        xTrainT = tf.tensor2d(xTrainArr, [trainCount, stateDim]);
        const yTrainIdx = tf.tensor1d(yTrainArr, 'int32');
        yTrainT = tf.oneHot(yTrainIdx, actionDim);
        yTrainIdx.dispose();

        xValT = tf.tensor2d(xValArr, [valCount, stateDim]);
        const yValIdx = tf.tensor1d(yValArr, 'int32');
        yValT = tf.oneHot(yValIdx, actionDim);
        yValIdx.dispose();

        activeModel = buildBehaviorCloningNetwork(stateDim, actionDim, hidden1, hidden2, learningRate);

        if (trainPoseHead) {
            yPoseTrainT = tf.tensor2d(new Float32Array(msg.yPoseTrainBuffer), [trainCount, poseDim]);
            yPoseValT = tf.tensor2d(new Float32Array(msg.yPoseValBuffer), [valCount, poseDim]);
            activePoseModel = buildPoseRegressorNetwork(stateDim, poseDim, poseLr);
        }

        let bestValLoss = Infinity;
        let bestWeights = null;
        let bestEpoch = 0;
        let noImproveCount = 0;

        let bestPoseValLoss = Infinity;
        let bestPoseWeights = null;

        let lastLoss = 0;
        let lastAcc = 0;
        let lastValLoss = 0;
        let lastValAcc = 0;
        let lastPoseValMse = null;
        let completedEpochs = 0;

        for (let ep = 1; ep <= epochs; ep++) {
            if (isCancelled) {
                break;
            }

            const fitOpts = {
                epochs: 1,
                batchSize: Math.min(batchSize, trainCount),
                shuffle: true,
                validationData: [xValT, yValT],
                verbose: 0
            };
            if (useClassWeights && msg.classWeight) {
                fitOpts.classWeight = msg.classWeight;
            }

            const hist = await activeModel.fit(xTrainT, yTrainT, fitOpts);
            const h = hist.history || {};
            lastLoss = Number((h.loss?.[0] ?? 0).toFixed(6));
            lastAcc = Number((h.acc?.[0] ?? h.accuracy?.[0] ?? 0).toFixed(6));
            lastValLoss = Number((h.val_loss?.[0] ?? lastLoss).toFixed(6));
            lastValAcc = Number((h.val_acc?.[0] ?? h.val_accuracy?.[0] ?? lastAcc).toFixed(6));

            if (activePoseModel) {
                const poseHist = await activePoseModel.fit(xTrainT, yPoseTrainT, {
                    epochs: 1,
                    batchSize: Math.min(batchSize, trainCount),
                    shuffle: true,
                    validationData: [xValT, yPoseValT],
                    verbose: 0
                });
                const ph = poseHist.history || {};
                const poseValLoss = Number((ph.val_loss?.[0] ?? ph.loss?.[0] ?? 0).toFixed(6));
                lastPoseValMse = poseValLoss;
                if (poseValLoss < bestPoseValLoss - 1e-5) {
                    bestPoseValLoss = poseValLoss;
                    bestPoseWeights = extractSerializableWeights(activePoseModel);
                }
            }

            completedEpochs = ep;

            const monitorLoss = valCount > 0 ? lastValLoss : lastLoss;
            let isBest = false;
            if (monitorLoss < bestValLoss - 1e-4) {
                bestValLoss = monitorLoss;
                bestEpoch = ep;
                bestWeights = extractSerializableWeights(activeModel);
                noImproveCount = 0;
                isBest = true;
            } else {
                noImproveCount++;
            }

            self.postMessage({
                type: 'EPOCH_PROGRESS',
                epoch: ep,
                totalEpochs: epochs,
                loss: lastLoss,
                accuracy: lastAcc,
                val_loss: lastValLoss,
                val_accuracy: lastValAcc,
                poseValMse: lastPoseValMse,
                isBest,
                bestEpoch,
                learningRate
            });

            if (ep >= 15 && noImproveCount >= patience) {
                break;
            }

            // Yield event loop so CANCEL messages can be processed immediately
            await new Promise(r => setTimeout(r, 0));
        }

        if (isCancelled) {
            self.postMessage({
                type: 'TRAINING_CANCELLED',
                epochsCompleted: completedEpochs
            });
            return;
        }

        // Restore best checkpoint weights before evaluation & export
        if (bestWeights) {
            restoreWeightsFromSerialized(activeModel, bestWeights);
        }
        if (activePoseModel && bestPoseWeights) {
            restoreWeightsFromSerialized(activePoseModel, bestPoseWeights);
        }

        const valPredClasses = tf.tidy(() => {
            const preds = activeModel.predict(xValT);
            return Array.from(preds.argMax(-1).dataSync());
        });

        const finalWeights = bestWeights || extractSerializableWeights(activeModel);
        const finalPoseWeights = activePoseModel
            ? (bestPoseWeights || extractSerializableWeights(activePoseModel))
            : null;

        self.postMessage({
            type: 'TRAINING_COMPLETE',
            epochsCompleted: completedEpochs,
            bestEpoch: bestEpoch || completedEpochs,
            finalLoss: lastLoss,
            finalAccuracy: lastAcc,
            finalValLoss: bestValLoss < Infinity ? bestValLoss : lastValLoss,
            finalValAccuracy: lastValAcc,
            poseValMse: bestPoseValLoss < Infinity ? bestPoseValLoss : lastPoseValMse,
            yValTrue: Array.from(yValArr),
            yValPred: valPredClasses,
            architecture: {
                inputDim: stateDim,
                hiddenLayers: [hidden1, hidden2],
                outputActions: actionDim,
                poseDim: activePoseModel ? poseDim : 0,
                poseHiddenLayers: activePoseModel ? [96, 48] : [],
                poseActivation: activePoseModel ? 'tanh' : null,
                activations: ['relu', 'relu', 'softmax'],
                optimizer: 'adam',
                learningRate,
                poseLearningRate: poseLr
            },
            weights: finalWeights,
            poseWeights: finalPoseWeights
        });
    } catch (err) {
        self.postMessage({
            type: 'TRAINING_ERROR',
            message: err?.message || 'An error occurred while training the Behavior Cloning model.'
        });
    } finally {
        if (xTrainT) xTrainT.dispose();
        if (yTrainT) yTrainT.dispose();
        if (xValT) xValT.dispose();
        if (yValT) yValT.dispose();
        if (yPoseTrainT) yPoseTrainT.dispose();
        if (yPoseValT) yPoseValT.dispose();
    }
}

self.onmessage = async function (e) {
    const msg = e.data || {};
    if (msg.cmd === 'START_TRAINING') {
        await handleStartTraining(msg);
    } else if (msg.cmd === 'CANCEL_TRAINING') {
        isCancelled = true;
    }
};
