/**
 * ModelEvaluator.js
 * Computes 9x9 confusion matrix, per-class precision/recall/F1, macro F1,
 * overall accuracy, and class-collapse diagnostics for Behavior Cloning models.
 */
import { IMITATION_ACTIONS, ACTION_COUNT } from './MotionInterpreter.js';

const SHORT_CLASS_LABELS = ['NEU', 'FWD', 'BWD', 'LFT', 'RGT', 'ARM_L', 'ARM_R', 'BOTH', 'SQT'];

export class ModelEvaluator {
    static evaluate(yTrueArray, yPredArray, numClasses = ACTION_COUNT, poseMetrics = null) {
        const matrix = Array.from({ length: numClasses }, () => new Array(numClasses).fill(0));
        let correct = 0;
        const total = Math.min(yTrueArray.length, yPredArray.length);

        for (let i = 0; i < total; i++) {
            const t = yTrueArray[i];
            const p = yPredArray[i];
            if (t >= 0 && t < numClasses && p >= 0 && p < numClasses) {
                matrix[t][p]++;
                if (t === p) correct++;
            }
        }

        const perClass = [];
        let macroF1Sum = 0;
        let activeClassCount = 0;
        const predClassCounts = new Array(numClasses).fill(0);

        for (let c = 0; c < numClasses; c++) {
            const tp = matrix[c][c];
            let fn = 0;
            let fp = 0;
            for (let j = 0; j < numClasses; j++) {
                if (j !== c) {
                    fn += matrix[c][j];
                    fp += matrix[j][c];
                }
                predClassCounts[c] += matrix[j][c];
            }
            const support = tp + fn;
            const precision = (tp + fp) > 0 ? tp / (tp + fp) : 0;
            const recall = support > 0 ? tp / support : 0;
            const f1 = (precision + recall) > 0 ? (2 * precision * recall) / (precision + recall) : 0;

            if (support > 0) {
                macroF1Sum += f1;
                activeClassCount++;
            }

            perClass.push({
                actionId: c,
                code: SHORT_CLASS_LABELS[c] || IMITATION_ACTIONS[c]?.code || `A${c}`,
                label: IMITATION_ACTIONS[c]?.label || `Action ${c}`,
                support,
                precision: Number(precision.toFixed(3)),
                recall: Number(recall.toFixed(3)),
                f1: Number(f1.toFixed(3))
            });
        }

        const accuracy = total > 0 ? correct / total : 0;
        const macroF1 = activeClassCount > 0 ? macroF1Sum / activeClassCount : 0;

        // Detect potential class collapse (model predicting only 1 class)
        const predictedNonZero = predClassCounts.filter(cnt => cnt > 0).length;
        const warnings = [];
        if (total > 0 && predictedNonZero <= 1 && activeClassCount > 1) {
            warnings.push('Model predicts only 1 dominant motion class! Record more diverse poses (Arms, Squat, Turn, Forward) and retrain.');
        }
        if (accuracy > 0.85 && macroF1 < 0.45 && activeClassCount > 2) {
            warnings.push('High overall accuracy but low Macro-F1: check class imbalance across recorded motion demonstrations.');
        }

        return {
            total,
            correct,
            numClasses,
            accuracy: Number(accuracy.toFixed(4)),
            macroF1: Number(macroF1.toFixed(4)),
            poseMse: poseMetrics?.poseValMse ?? null,
            confusionMatrix: matrix,
            perClass,
            warnings
        };
    }
}
