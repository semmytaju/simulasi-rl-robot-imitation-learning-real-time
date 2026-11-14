/**
 * DatasetManager.js
 * Manages demonstration datasets & batch persistence via PHP MVC REST endpoints (/api/demonstrations/*).
 */
export class DatasetManager {
    constructor(options = {}) {
        this.appPath = options.appPath || '';
        this.csrfToken = options.csrfToken || '';
        this.maxBatchSize = options.maxBatchSize || 200;
    }

    setCsrfToken(token) {
        if (token) this.csrfToken = token;
    }

    async _request(endpoint, method = 'GET', body = null) {
        const headers = {
            'Accept': 'application/json'
        };
        if (this.csrfToken) {
            headers['X-CSRF-TOKEN'] = this.csrfToken;
        }
        const opts = { method, headers, credentials: 'same-origin' };
        if (body !== null && method !== 'GET') {
            headers['Content-Type'] = 'application/json';
            opts.body = JSON.stringify({
                csrf_token: this.csrfToken,
                ...body
            });
        }

        const resp = await fetch(`${this.appPath}${endpoint}`, opts);
        let data = null;
        try {
            data = await resp.json();
        } catch (e) {
            throw new Error(`Invalid server response (HTTP ${resp.status}).`);
        }
        if (!resp.ok || !data || data.success === false) {
            throw new Error(data?.message || `API request failed (HTTP ${resp.status}).`);
        }
        return data;
    }

    async createDemonstration(meta) {
        return await this._request('/api/demonstrations/create', 'POST', meta);
    }

    async saveBatch(demonstrationId, transitions, summary = null) {
        if (!demonstrationId || !Array.isArray(transitions) || transitions.length === 0) {
            return { success: true, inserted: 0 };
        }

        let totalInserted = 0;
        for (let i = 0; i < transitions.length; i += this.maxBatchSize) {
            const chunk = transitions.slice(i, i + this.maxBatchSize);
            const isLastChunk = (i + this.maxBatchSize) >= transitions.length;
            const res = await this._request('/api/demonstrations/save-batch', 'POST', {
                demonstration_id: demonstrationId,
                transitions: chunk,
                summary: isLastChunk ? summary : null
            });
            totalInserted += Number(res.inserted || chunk.length);
        }
        return { success: true, inserted: totalInserted };
    }

    async listDemonstrations(limit = 50, offset = 0) {
        const res = await this._request(`/api/demonstrations/list?limit=${limit}&offset=${offset}`, 'GET');
        return Array.isArray(res) ? res : (res?.demonstrations || res?.data || []);
    }

    async getDemonstrationDetail(demonstrationId) {
        return await this._request(`/api/demonstrations/detail/${demonstrationId}`, 'GET');
    }

    /**
     * Load all transitions for a demonstration using chunked pagination.
     */
    async loadReplayTransitions(demonstrationId, chunkSize = 500) {
        let offset = 0;
        let allTransitions = [];
        let demoInfo = null;

        while (true) {
            const res = await this._request(
                `/api/demonstrations/replay/${demonstrationId}?limit=${chunkSize}&offset=${offset}`,
                'GET'
            );
            if (!demoInfo && res.demonstration) {
                demoInfo = res.demonstration;
            }
            const batch = Array.isArray(res.transitions) ? res.transitions : [];
            allTransitions = allTransitions.concat(batch);
            if (batch.length < chunkSize) {
                break;
            }
            offset += chunkSize;
        }

        return { demonstration: demoInfo, transitions: allTransitions };
    }

    async deleteDemonstration(demonstrationId) {
        return await this._request('/api/demonstrations/delete', 'POST', {
            demonstration_id: demonstrationId
        });
    }
}
