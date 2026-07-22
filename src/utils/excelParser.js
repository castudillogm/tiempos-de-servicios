// utils/excelParser.js
import * as XLSX from 'xlsx';

/**
 * Get actual weekday index (0-6) from FechaExpedicion
 * 0: Monday, 6: Sunday
 */
function getDayIntFromFecha(fechaVal) {
    if (fechaVal === undefined || fechaVal === null || fechaVal === '') return 0;
    
    try {
        // Si es un número (Fecha serial de Excel)
        if (typeof fechaVal === 'number') {
            // Excel dates are days since Dec 30, 1899
            const date = new Date(Math.round((fechaVal - 25569) * 86400 * 1000));
            const jsDay = date.getDay(); // 0: Sun, 1: Mon
            return jsDay === 0 ? 6 : jsDay - 1;
        }
        
        // Si es un string Date real ISO
        if (fechaVal instanceof Date) {
            const jsDay = fechaVal.getDay();
            return jsDay === 0 ? 6 : jsDay - 1;
        }

        // Parse manual string
        const cleanStr = fechaVal.toString().trim();
        
        // Intenta formato directo yyMMdd HH:mm ("260112 08:46")
        const datePart = cleanStr.split(' ')[0];
        if (datePart.length >= 6 && !datePart.includes('-') && !datePart.includes('/')) {
            const yy = parseInt(datePart.substring(0, 2));
            const mm = parseInt(datePart.substring(2, 4)) - 1; // 0-indexed in JS
            const dd = parseInt(datePart.substring(4, 6));
            
            if (!isNaN(yy) && !isNaN(mm) && !isNaN(dd)) {
                const date = new Date(2000 + yy, mm, dd);
                const jsDay = date.getDay(); 
                return jsDay === 0 ? 6 : jsDay - 1;
            }
        }
        
        // Intenta fallback a formato ISO o string leíble por Date()
        const standardDate = new Date(cleanStr);
        if (!isNaN(standardDate.getTime())) {
            const jsDay = standardDate.getDay();
            return jsDay === 0 ? 6 : jsDay - 1;
        }
        
    } catch (err) {
        console.error("Error parsing FechaExpedicion:", err);
    }
    return 0; // Fallback to Monday
}

/**
 * Parses raw records from SheetJS into the unified format needed for calculations
 * @param {Object[]} rawRecords - JSON output from SheetJS
 * @returns {Object[]} Processed records
 */
export function processParsedRecords(rawRecords) {
    if (!rawRecords || rawRecords.length === 0) {
        throw new Error("El archivo de Excel está vacío.");
    }
    
    const sample = rawRecords[0];
    const requiredCols = ['PlazaOrigen', 'Fase', 'ADR', 'FechaExpedicion', 'Codigo', 'NumPartidas', 'DuracionMinutos'];
    const missing = requiredCols.filter(col => !(col in sample));
    if (missing.length > 0) {
        throw new Error(`Faltan columnas obligatorias: ${missing.join(', ')}`);
    }
    
    return rawRecords.map(r => {
        // Helper to find key case-insensitively and ignoring spaces
        const getVal = (keys, def) => {
            for (let k in r) {
                let normK = k.replace(/\s+/g, '').toUpperCase();
                for (let pk of keys) {
                    if (normK === pk.toUpperCase()) return r[k];
                }
            }
            return def;
        };

        const cod = r.Codigo ? r.Codigo.toString() : '';
        const fechaVal = r.FechaExpedicion; // Pass exactly what XLSX gave us
        const dayInt = getDayIntFromFecha(fechaVal);
        const diasMap = {0: 'Lunes', 1: 'Martes', 2: 'Miércoles', 3: 'Jueves', 4: 'Viernes', 5: 'Sábado', 6: 'Domingo'};
        const diaReal = diasMap[dayInt] || 'Lunes';
        const diaBin = dayInt >= 3 ? 1 : 0;
        const diaGrp = diaBin === 1 ? 'J-V' : 'L-X';
        const adrBin = (r.ADR && r.ADR.toString().toUpperCase() === 'SI') ? 1 : 0;
        const adrStr = adrBin === 1 ? 'SI' : 'NO';
        
        // Parse optional parent phase column or default to 2 - EXPORTACION
        const fpRaw = getVal(['FasePadre'], '2 - EXPORTACION');
        const fpVal = fpRaw ? fpRaw.toString().trim() : '2 - EXPORTACION';
        
        // Classification of Zone
        const destRaw = getVal(['PlazaDestino', 'Destino'], '');
        let dest = destRaw ? destRaw.toString().toUpperCase().trim() : '';
        
        const origRaw = getVal(['PlazaOrigen', 'Origen'], '');
        let orig = origRaw ? origRaw.toString().toUpperCase().trim() : '';
        
        // Unificar códigos de Tenerife bajo una misma plaza (SCT - Santa Cruz de Tenerife)
        const tenerifeCodes = ['TFN', 'TFS', 'TCI'];
        if (tenerifeCodes.includes(orig)) orig = 'SCT';
        if (tenerifeCodes.includes(dest)) dest = 'SCT';
        
        const baleares = ['PMI', 'MAH', 'IBZ'];
        const canarias = ['LPA', 'ACE', 'FUE', 'SPC', 'SCT']; // TFN, TFS, TCI eliminados de aquí ya que ahora son SCT
        
        let zonaOrigenAsignada = 'Península';
        if (orig === '') zonaOrigenAsignada = 'Sin Asignar';
        else if (baleares.includes(orig)) zonaOrigenAsignada = 'Baleares';
        else if (canarias.includes(orig)) zonaOrigenAsignada = 'Canarias';

        let zonaDestinoAsignada = 'Península';
        if (dest === '') zonaDestinoAsignada = 'Sin Asignar';
        else if (baleares.includes(dest)) zonaDestinoAsignada = 'Baleares';
        else if (canarias.includes(dest)) zonaDestinoAsignada = 'Canarias';
        
        const compRaw = getVal(['Completo'], '');
        const completoBin = (compRaw && compRaw.toString().toUpperCase().trim() === 'SI') ? 1 : 0;
        const completoStr = completoBin === 1 ? 'SI' : 'NO';
        
        return {
            ZonaOrigen: zonaOrigenAsignada,
            ZonaDestino: zonaDestinoAsignada,
            Zona: zonaOrigenAsignada,
            PlazaOrigen: orig,
            PlazaDestino: dest,
            FasePadre: fpVal,
            Fase: r.Fase ? r.Fase.toString().trim() : '',
            ADR: adrStr,
            ADR_Binario: adrBin,
            FechaExpedicion: fechaVal,
            Codigo: cod,
            NumPartidas: parseInt(r.NumPartidas) || 1,
            DuracionMinutos: parseFloat(r.DuracionMinutos) || 0.0,
            Dia: diaReal,
            Dia_Int: dayInt,
            Dia_Binario: diaBin,
            Dia_Grupo: diaGrp,
            Completo: completoStr
        };
    });
}

/**
 * Reads an ArrayBuffer or File from Excel and converts it to JSON using SheetJS
 * @param {ArrayBuffer} buffer - The excel file data
 * @returns {Object[]} The raw JSON rows
 */
export function readExcelBuffer(buffer) {
    const workbook = XLSX.read(buffer, { type: 'array' });
    const firstSheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[firstSheetName];
    return XLSX.utils.sheet_to_json(worksheet);
}
