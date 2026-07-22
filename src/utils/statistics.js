// utils/statistics.js

/**
 * Calculates the given percentile (q) of a numeric array.
 * @param {number[]} arr - Array of numbers (e.g., durations).
 * @param {number} q - Percentile (0 to 1).
 * @returns {number} The calculated percentile.
 */
export function getPercentile(arr, q) {
    if (arr.length === 0) return 0;
    const sorted = arr.slice().sort((a, b) => a - b);
    const pos = (sorted.length - 1) * q;
    const base = Math.floor(pos);
    const rest = pos - base;
    if (sorted[base + 1] !== undefined) {
        return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
    } else {
        return sorted[base];
    }
}

/**
 * Calculates Tukey limits (Q1, Median, Q3, IQR, etc.) and separates clean from aberrant data.
 * @param {number[]} durations - Array of durations in minutes.
 * @returns {Object} Tukey statistics object.
 */
export function calculateTukeyStats(durations) {
    if (durations.length === 0) {
        return {
            Total: 0, Limpios: 0, Aberrantes: 0, PctLimpios: 0, PctAberrantes: 0,
            Q1: 0, Mediana: 0, Q3: 0, P80: 0, P85: 0, P90: 0, P95: 0, IQR: 0, LimiteTukey: 0, MinLimpio: 0, MediaLimpia: 0, MaxLimpio: 0
        };
    }
    
    const total = durations.length;
    const q1 = getPercentile(durations, 0.25);
    const mediana = getPercentile(durations, 0.50);
    const q3 = getPercentile(durations, 0.75);
    const p80 = getPercentile(durations, 0.80);
    const p85 = getPercentile(durations, 0.85);
    const p90 = getPercentile(durations, 0.90);
    const p95 = getPercentile(durations, 0.95);
    const iqr = q3 - q1;
    const limTukey = q3 + 1.5 * iqr;
    
    const cleanDurations = durations.filter(d => d <= limTukey);
    const limpiosCount = cleanDurations.length;
    const aberrantesCount = total - limpiosCount;
    
    const pctLimpios = parseFloat(((limpiosCount / total) * 100).toFixed(2));
    const pctAberrantes = parseFloat((100 - pctLimpios).toFixed(2));
    
    const minLimpio = limpiosCount > 0 ? getPercentile(cleanDurations, 0.05) : 0;
    const mediaLimpia = limpiosCount > 0 ? (cleanDurations.reduce((sum, val) => sum + val, 0) / limpiosCount) : 0;
    const maxLimpio = limpiosCount > 0 ? getPercentile(cleanDurations, 0.95) : 0;
    
    return {
        Total: total,
        Limpios: limpiosCount,
        Aberrantes: aberrantesCount,
        PctLimpios: pctLimpios,
        PctAberrantes: pctAberrantes,
        Q1: q1,
        Mediana: mediana,
        Q3: q3,
        P80: p80,
        P85: p85,
        P90: p90,
        P95: p95,
        IQR: iqr,
        LimiteTukey: limTukey,
        MinLimpio: minLimpio,
        MediaLimpia: mediaLimpia,
        MaxLimpio: maxLimpio
    };
}

/**
 * Gauss-Jordan solver for N x N matrix M and N x 1 vector V
 */
function solveLinearSystem(M, V) {
    const n = V.length;
    const A = [];
    for (let i = 0; i < n; i++) {
        A.push([...M[i], V[i]]);
    }
    
    for (let i = 0; i < n; i++) {
        let maxEl = Math.abs(A[i][i]);
        let maxRow = i;
        for (let k = i + 1; k < n; k++) {
            if (Math.abs(A[k][i]) > maxEl) {
                maxEl = Math.abs(A[k][i]);
                maxRow = k;
            }
        }
        
        // Swap rows
        for (let k = i; k < n + 1; k++) {
            const tmp = A[maxRow][k];
            A[maxRow][k] = A[i][k];
            A[i][k] = tmp;
        }
        
        if (Math.abs(A[i][i]) < 1e-12) {
            return null; // Singular matrix
        }
        
        // Zero out columns below A[i][i]
        for (let k = i + 1; k < n; k++) {
            const c = -A[k][i] / A[i][i];
            for (let j = i; j < n + 1; j++) {
                if (i === j) {
                    A[k][j] = 0;
                } else {
                    A[k][j] += c * A[i][j];
                }
            }
        }
    }
    
    // Back substitution
    const x = new Array(n).fill(0);
    for (let i = n - 1; i >= 0; i--) {
        x[i] = A[i][n] / A[i][i];
        for (let k = i - 1; k >= 0; k--) {
            A[k][n] -= A[k][i] * x[i];
        }
    }
    return x;
}

/**
 * Ordinary Least Squares multivariable regression solver
 * Dynamically drops variables with 0 variance to prevent singular matrices.
 * @param {Object[]} cleanData - Array of cleaned record objects
 * @returns {Object|null} Regression coefficients and R2 score
 */
export function fitOLS(cleanData) {
    if (cleanData.length < 10) return null;
    
    const hasPartidas = new Set(cleanData.map(r => r.NumPartidas)).size > 1;
    const hasDia = new Set(cleanData.map(r => r.Dia_Binario)).size > 1;
    
    let numVars = 1; // Intercept
    if (hasPartidas) numVars++;
    if (hasDia) numVars++;
    
    const M = [];
    for (let i = 0; i < numVars; i++) {
        M.push(new Array(numVars).fill(0));
    }
    const V = new Array(numVars).fill(0);
    
    for (let i = 0; i < cleanData.length; i++) {
        const r = cleanData[i];
        const y = r.DuracionMinutos;
        
        let x = [1.0];
        if (hasPartidas) x.push(parseFloat(r.NumPartidas) || 0);
        if (hasDia) x.push(r.Dia_Binario);
        
        for (let j = 0; j < numVars; j++) {
            for (let k = 0; k < numVars; k++) {
                M[j][k] += x[j] * x[k];
            }
            V[j] += x[j] * y;
        }
    }
    
    const beta = solveLinearSystem(M, V);
    if (!beta) return null;
    
    const yValues = cleanData.map(r => r.DuracionMinutos);
    const ySum = yValues.reduce((sum, v) => sum + v, 0);
    const yMean = ySum / yValues.length;
    
    let totalSS = 0;
    let residualSS = 0;
    
    for (let i = 0; i < cleanData.length; i++) {
        const r = cleanData[i];
        const y = r.DuracionMinutos;
        
        let pred = beta[0];
        let betaIdx = 1;
        if (hasPartidas) {
            pred += beta[betaIdx] * (parseFloat(r.NumPartidas) || 0);
            betaIdx++;
        }
        if (hasDia) {
            pred += beta[betaIdx] * r.Dia_Binario;
        }
        
        totalSS += (y - yMean) * (y - yMean);
        residualSS += (y - pred) * (y - pred);
    }
    
    const r2 = totalSS > 0 ? (1 - (residualSS / totalSS)) : 0.0;
    
    return {
        Intercept: beta[0],
        R2: Math.min(1.0, Math.max(0.0, r2))
    };
}

/**
 * Calculates Pareto threshold for a dataset
 */
export function calculateParetoThreshold(subset, pct = 100) {
    const freq = {};
    for(let i=0; i<subset.length; i++) {
        const p = subset[i].NumPartidas;
        freq[p] = (freq[p] || 0) + 1;
    }
    const sortedKeys = Object.keys(freq).map(Number).sort((a,b) => freq[b] - freq[a]);
    const threshold = subset.length * (pct / 100.0);
    let cumulative = 0;
    const paretoSet = new Set();
    for(const key of sortedKeys) {
        cumulative += freq[key];
        paretoSet.add(key);
        if (cumulative >= threshold) break;
    }
    return { paretoSet, freq, sortedKeys, total: subset.length };
}

/**
 * Calculates theoretical Gaussian curve points for a given field in the records.
 * Generates an array of { x, y } where x is the field value and y is the probability density.
 */
export function calculateGaussianCurve(records, field = 'NumPartidas') {
    const values = records.map(r => Number(r[field])).filter(v => !isNaN(v));
    if (values.length === 0) return [];

    // Calculate Mean
    const sum = values.reduce((a, b) => a + b, 0);
    const mean = sum / values.length;

    // Calculate Standard Deviation
    const variance = values.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / values.length;
    const stdDev = Math.sqrt(variance) || 1; // Prevent division by zero

    const minX = Math.floor(values.reduce((min, v) => (v < min ? v : min), values[0]));
    const maxX = Math.ceil(values.reduce((max, v) => (v > max ? v : max), values[0]));

    const data = [];
    for (let x = minX; x <= maxX; x++) {
        // Gaussian Probability Density Function
        const exponent = -0.5 * Math.pow((x - mean) / stdDev, 2);
        const y = (1 / (stdDev * Math.sqrt(2 * Math.PI))) * Math.exp(exponent);
        
        // Also calculate the actual count (histogram) for comparison if needed
        const count = values.filter(v => v === x).length;

        data.push({ x, y, count });
    }
    return data;
}
