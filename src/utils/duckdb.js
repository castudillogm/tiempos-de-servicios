import * as duckdb from '@duckdb/duckdb-wasm';

const JSDELIVR_BUNDLES = duckdb.getJsDelivrBundles();

let dbInstance = null;
let connInstance = null;

export async function getDuckDB() {
    if (dbInstance && connInstance) {
        return { db: dbInstance, conn: connInstance };
    }

    const bundle = await duckdb.selectBundle(JSDELIVR_BUNDLES);
    const worker_url = URL.createObjectURL(
        new Blob([`importScripts("${bundle.mainWorker}");`], { type: 'text/javascript' })
    );

    const worker = new Worker(worker_url);
    const logger = new duckdb.ConsoleLogger();
    const db = new duckdb.AsyncDuckDB(logger, worker);
    
    await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
    URL.revokeObjectURL(worker_url);

    const conn = await db.connect();
    
    dbInstance = db;
    connInstance = conn;
    
    return { db, conn };
}

/**
 * Creates the normalized table in DuckDB directly from CSV, matching the old JS logic but in SQL
 */
async function processAndCreateSQLTable(conn, fileName, tableName) {
    await conn.query(`DROP TABLE IF EXISTS ${tableName}`);
    
    // First, let's get the columns that actually exist in the CSV
    const descResult = await conn.query(`DESCRIBE SELECT * FROM read_csv_auto('${fileName}', normalize_names=true, header=true)`);
    const columns = descResult.toArray().map(r => r.toJSON().column_name.toLowerCase());
    
    const getCol = (possibleNames) => {
        const found = possibleNames.find(n => columns.includes(n.toLowerCase()));
        return found ? found : "''"; // return column name if exists, else empty string literal
    };
    
    const colOrigen = getCol(['origen', 'plazaorigen']);
    const colDestino = getCol(['destino', 'plazadestino']);
    const colFasePadre = getCol(['fasepadre']);
    const colFase = getCol(['fase']);
    const colADR = getCol(['adr']);
    const colFechaExpedicion = getCol(['fechaexpedicion']);
    const colCompleto = getCol(['completo']);
    const colCodigo = getCol(['codigo']);
    const colNumPartidas = getCol(['numpartidas']);
    const colDuracionMinutos = getCol(['duracionminutos']);

    const usedCols = [colOrigen, colDestino, colFasePadre, colFase, colADR, colFechaExpedicion, colCompleto, colCodigo, colNumPartidas, colDuracionMinutos].map(c => c.toLowerCase());
    const extraCols = columns.filter(c => !usedCols.includes(c) && c !== "''");
    const extraColsSelect = extraCols.length > 0 ? extraCols.map(c => `"${c}"`).join(', ') + ',' : '';

    const createTableQuery = `
        CREATE TABLE ${tableName} AS 
        SELECT 
            ${extraColsSelect}
            COALESCE(${colOrigen}, '') AS PlazaOrigenRaw,
            COALESCE(${colDestino}, '') AS PlazaDestinoRaw,
            CASE 
                WHEN UPPER(TRIM(CAST(COALESCE(${colOrigen}, '') AS VARCHAR))) IN ('TFN', 'TFS', 'TCI') THEN 'SCT'
                ELSE UPPER(TRIM(CAST(COALESCE(${colOrigen}, '') AS VARCHAR)))
            END AS PlazaOrigen,
            CASE 
                WHEN UPPER(TRIM(CAST(COALESCE(${colDestino}, '') AS VARCHAR))) IN ('TFN', 'TFS', 'TCI') THEN 'SCT'
                ELSE UPPER(TRIM(CAST(COALESCE(${colDestino}, '') AS VARCHAR)))
            END AS PlazaDestino,
            
            CASE 
                WHEN UPPER(TRIM(CAST(COALESCE(${colOrigen}, '') AS VARCHAR))) IN ('PMI', 'MAH', 'IBZ') THEN 'Baleares'
                WHEN UPPER(TRIM(CAST(COALESCE(${colOrigen}, '') AS VARCHAR))) IN ('LPA', 'ACE', 'FUE', 'SPC', 'SCT', 'TFN', 'TFS', 'TCI') THEN 'Canarias'
                WHEN TRIM(CAST(COALESCE(${colOrigen}, '') AS VARCHAR)) = '' THEN 'Sin Asignar'
                ELSE 'Península' 
            END AS ZonaOrigen,
            
            CASE 
                WHEN UPPER(TRIM(CAST(COALESCE(${colDestino}, '') AS VARCHAR))) IN ('PMI', 'MAH', 'IBZ') THEN 'Baleares'
                WHEN UPPER(TRIM(CAST(COALESCE(${colDestino}, '') AS VARCHAR))) IN ('LPA', 'ACE', 'FUE', 'SPC', 'SCT', 'TFN', 'TFS', 'TCI') THEN 'Canarias'
                WHEN TRIM(CAST(COALESCE(${colDestino}, '') AS VARCHAR)) = '' THEN 'Sin Asignar'
                ELSE 'Península' 
            END AS ZonaDestino,
            
            COALESCE(TRIM(CAST(${colFasePadre} AS VARCHAR)), '2 - EXPORTACION') AS FasePadre,
            TRIM(CAST(${colFase} AS VARCHAR)) AS Fase,
            
            CASE WHEN UPPER(TRIM(CAST(${colADR} AS VARCHAR))) IN ('SI', 'SÍ') THEN 'SI' ELSE 'NO' END AS ADR,
            CASE WHEN UPPER(TRIM(CAST(${colADR} AS VARCHAR))) IN ('SI', 'SÍ') THEN 1 ELSE 0 END AS ADR_Binario,
            
            CAST(${colFechaExpedicion} AS VARCHAR) AS FechaExpedicion,
            
            COALESCE(
                TRY_CAST(${colFechaExpedicion} AS TIMESTAMP),
                TRY_STRPTIME(${colFechaExpedicion}, '%d/%m/%Y %H:%M:%S'),
                TRY_STRPTIME(${colFechaExpedicion}, '%d/%m/%Y %H:%M'),
                TRY_STRPTIME(${colFechaExpedicion}, '%d/%m/%Y'),
                TRY_STRPTIME(${colFechaExpedicion}, '%d-%m-%Y %H:%M:%S'),
                TRY_STRPTIME(${colFechaExpedicion}, '%d-%m-%Y %H:%M'),
                TRY_STRPTIME(${colFechaExpedicion}, '%d-%m-%Y'),
                TRY_STRPTIME(${colFechaExpedicion}, '%m/%d/%Y %H:%M:%S'),
                TRY_STRPTIME(${colFechaExpedicion}, '%m/%d/%Y %H:%M'),
                TRY_STRPTIME(TRIM(CAST(${colFechaExpedicion} AS VARCHAR)), '%y%m%d %H:%M:%S'),
                TRY_STRPTIME(TRIM(CAST(${colFechaExpedicion} AS VARCHAR)), '%y%m%d %H:%M'),
                TRY_STRPTIME(TRIM(CAST(${colFechaExpedicion} AS VARCHAR)), '%y%m%d')
            ) AS FechaTs,
            
            CASE ISODOW(
                COALESCE(
                    TRY_CAST(${colFechaExpedicion} AS TIMESTAMP),
                    TRY_STRPTIME(${colFechaExpedicion}, '%d/%m/%Y %H:%M:%S'),
                    TRY_STRPTIME(${colFechaExpedicion}, '%d/%m/%Y %H:%M'),
                    TRY_STRPTIME(${colFechaExpedicion}, '%d/%m/%Y'),
                    TRY_STRPTIME(${colFechaExpedicion}, '%d-%m-%Y %H:%M:%S'),
                    TRY_STRPTIME(${colFechaExpedicion}, '%d-%m-%Y %H:%M'),
                    TRY_STRPTIME(${colFechaExpedicion}, '%d-%m-%Y'),
                    TRY_STRPTIME(${colFechaExpedicion}, '%m/%d/%Y %H:%M:%S'),
                    TRY_STRPTIME(${colFechaExpedicion}, '%m/%d/%Y %H:%M'),
                    TRY_STRPTIME(TRIM(CAST(${colFechaExpedicion} AS VARCHAR)), '%y%m%d %H:%M:%S'),
                    TRY_STRPTIME(TRIM(CAST(${colFechaExpedicion} AS VARCHAR)), '%y%m%d %H:%M'),
                    TRY_STRPTIME(TRIM(CAST(${colFechaExpedicion} AS VARCHAR)), '%y%m%d')
                )
            )
                WHEN 1 THEN 'Lunes' WHEN 2 THEN 'Martes' WHEN 3 THEN 'Miércoles' 
                WHEN 4 THEN 'Jueves' WHEN 5 THEN 'Viernes' WHEN 6 THEN 'Sábado' WHEN 7 THEN 'Domingo'
                ELSE 'Lunes'
            END AS Dia,
            
            CASE WHEN ISODOW(
                COALESCE(
                    TRY_CAST(${colFechaExpedicion} AS TIMESTAMP),
                    TRY_STRPTIME(${colFechaExpedicion}, '%d/%m/%Y %H:%M:%S'),
                    TRY_STRPTIME(${colFechaExpedicion}, '%d/%m/%Y %H:%M'),
                    TRY_STRPTIME(${colFechaExpedicion}, '%d/%m/%Y'),
                    TRY_STRPTIME(${colFechaExpedicion}, '%d-%m-%Y %H:%M:%S'),
                    TRY_STRPTIME(${colFechaExpedicion}, '%d-%m-%Y %H:%M'),
                    TRY_STRPTIME(${colFechaExpedicion}, '%d-%m-%Y'),
                    TRY_STRPTIME(${colFechaExpedicion}, '%m/%d/%Y %H:%M:%S'),
                    TRY_STRPTIME(${colFechaExpedicion}, '%m/%d/%Y %H:%M'),
                    TRY_STRPTIME(TRIM(CAST(${colFechaExpedicion} AS VARCHAR)), '%y%m%d %H:%M:%S'),
                    TRY_STRPTIME(TRIM(CAST(${colFechaExpedicion} AS VARCHAR)), '%y%m%d %H:%M'),
                    TRY_STRPTIME(TRIM(CAST(${colFechaExpedicion} AS VARCHAR)), '%y%m%d')
                )
            ) >= 4 THEN 1 ELSE 0 END AS Dia_Binario,
            
            CASE WHEN UPPER(TRIM(CAST(${colCompleto} AS VARCHAR))) = 'SI' THEN 'SI' ELSE 'NO' END AS Completo,
            
            CAST(${colCodigo} AS VARCHAR) AS Codigo,
            TRY_CAST(${colNumPartidas} AS INTEGER) AS NumPartidas,
            TRY_CAST(REPLACE(CAST(${colDuracionMinutos} AS VARCHAR), ',', '.') AS DOUBLE) AS DuracionMinutos
        FROM read_csv_auto('${fileName}', normalize_names=true, header=true)
    `;
    
    await conn.query(createTableQuery);
}

export async function loadDataFromURL(url, tableName = 'records') {
    const { db, conn } = await getDuckDB();
    
    let fetchUrl = url;
    if (url.includes('docs.google.com/spreadsheets') && url.includes('/edit')) {
        fetchUrl = url.replace(/\/edit.*$/, '/export?format=csv');
    }
    
    try {
        const response = await fetch(fetchUrl);
        if (!response.ok) throw new Error("No se pudo obtener el archivo. Revisa si es público.");
        const text = await response.text();
        
        await db.registerFileText('data.csv', text);
        await processAndCreateSQLTable(conn, 'data.csv', tableName);
        return true;
    } catch (error) {
        console.error("Error loading data:", error);
        throw error;
    }
}

export async function loadDataFromFile(file, tableName = 'records') {
    const { db, conn } = await getDuckDB();
    
    if (!file.name.toLowerCase().endsWith('.csv')) {
        throw new Error("El archivo debe ser .csv para poder procesar millones de filas.");
    }
    
    await db.registerFileHandle('data.csv', file, duckdb.DuckDBDataProtocol.BROWSER_FILEREADER, true);
    await processAndCreateSQLTable(conn, 'data.csv', tableName);
    
    return true;
}

export async function getUniqueValuesFromDB(field) {
    const { conn } = await getDuckDB();
    const result = await conn.query(`SELECT DISTINCT "${field}" as val FROM records WHERE "${field}" IS NOT NULL AND CAST("${field}" AS VARCHAR) != '' ORDER BY val`);
    return result.toArray().map(r => r.toJSON().val);
}

export async function getDynamicColumns(tableName = 'records') {
    const { conn } = await getDuckDB();
    const descResult = await conn.query(`DESCRIBE ${tableName}`);
    const allCols = descResult.toArray().map(r => r.toJSON());
    
    const fixedCols = ['plazaorigenraw', 'plazadestinoraw', 'plazaorigen', 'plazadestino', 'zonaorigen', 'zonadestino', 'fasepadre', 'fase', 'adr', 'adr_binario', 'fechaexpedicion', 'fechats', 'dia', 'dia_binario', 'completo', 'codigo', 'numpartidas', 'duracionminutos'];
    
    const dynamicCols = allCols
        .filter(c => !fixedCols.includes(c.column_name.toLowerCase()) && c.column_type === 'VARCHAR')
        .map(c => c.column_name);
        
    return dynamicCols;
}

export async function executeQuery(query) {
    const { conn } = await getDuckDB();
    const result = await conn.query(query);
    return result.toArray().map(row => row.toJSON());
}
