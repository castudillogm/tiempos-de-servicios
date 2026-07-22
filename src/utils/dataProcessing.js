// utils/dataProcessing.js
import { calculateParetoThreshold } from './statistics';

/**
 * Filter state object structure
 */
export const defaultFilterState = {
    zonaOrigen: 'ALL',
    plazaOrigen: 'ALL',
    zonaDestino: 'ALL',
    plazaDestino: 'ALL',
    fasePadre: 'ALL',
    fase: 'ALL',
    dia: 'ALL',
    adr: 'ALL',
    completo: 'ALL',
    paretoPct: 100,
    excluirCeros: false
};

/**
 * Returns the filtered subset of records based on the provided filter state
 * @param {Object[]} records - Processed records
 * @param {Object} filterState - The active filter state
 * @param {string|null} overrideFase - Optional override for phase filtering
 * @returns {Object[]} Filtered records
 */
export function getFilteredSubset(records, filterState, overrideFase = null) {
    // Pre-process filter arrays to avoid splitting on every iteration
    const getFilterSet = (val) => (!val || val === 'ALL') ? null : new Set(val.split(','));
    
    const activeFilters = {
        ZonaOrigen: getFilterSet(filterState.zonaOrigen),
        PlazaOrigen: getFilterSet(filterState.plazaOrigen),
        ZonaDestino: getFilterSet(filterState.zonaDestino),
        PlazaDestino: getFilterSet(filterState.plazaDestino),
        FasePadre: getFilterSet(filterState.fasePadre),
        Fase: getFilterSet(overrideFase !== null ? overrideFase : filterState.fase),
        ADR: getFilterSet(filterState.adr),
        Completo: getFilterSet(filterState.completo),
        Dia: getFilterSet(filterState.dia),
    };

    const excluirCeros = filterState.excluirCeros;

    // Single pass filter (much faster)
    let subset = records.filter(r => {
        if (excluirCeros && r.DuracionMinutos <= 0) return false;
        
        if (activeFilters.ZonaOrigen && !activeFilters.ZonaOrigen.has(r.ZonaOrigen)) return false;
        if (activeFilters.PlazaOrigen && !activeFilters.PlazaOrigen.has(r.PlazaOrigen)) return false;
        if (activeFilters.ZonaDestino && !activeFilters.ZonaDestino.has(r.ZonaDestino)) return false;
        if (activeFilters.PlazaDestino && !activeFilters.PlazaDestino.has(r.PlazaDestino)) return false;
        if (activeFilters.FasePadre && !activeFilters.FasePadre.has(r.FasePadre)) return false;
        if (activeFilters.Fase && !activeFilters.Fase.has(r.Fase)) return false;
        if (activeFilters.ADR && !activeFilters.ADR.has(r.ADR)) return false;
        if (activeFilters.Completo && !activeFilters.Completo.has(r.Completo)) return false;
        if (activeFilters.Dia && !activeFilters.Dia.has(r.Dia)) return false;
        
        return true;
    });

    if (filterState.paretoPct < 100) {
        const { paretoSet } = calculateParetoThreshold(subset, filterState.paretoPct);
        subset = subset.filter(r => paretoSet.has(r.NumPartidas));
    }

    return subset;
}

/**
 * Gets unique values for a specific field in the dataset
 */
export function getUniqueValues(records, field) {
    return [...new Set(records.map(r => r[field]))].filter(Boolean).sort();
}
