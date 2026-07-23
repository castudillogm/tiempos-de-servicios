import { useState, useRef, useMemo, useEffect, useTransition } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer } from 'recharts';
import Tree from 'react-d3-tree';
import { calculateTukeyStats, fitOLS, calculateGaussianCurve } from './utils/statistics';
import { defaultFilterState } from './utils/dataProcessing';
import { loadDataFromFile, loadDataFromURL, executeQuery, getUniqueValuesFromDB, getDynamicColumns } from './utils/duckdb';
import { collection, addDoc, getDocs, deleteDoc, doc } from 'firebase/firestore';
import { db } from './utils/firebase';

const MultiSelectCheckbox = ({ label, options, value, onChange }) => {
  const [isOpen, setIsOpen] = useState(false);
  const selectedArray = value === 'ALL' ? [] : value.split(',');

  const ref = useRef(null);
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (ref.current && !ref.current.contains(event.target)) setIsOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const toggleOption = (opt) => {
    if (opt === 'ALL') {
      onChange('ALL');
      return;
    }
    let newArr;
    if (selectedArray.includes(opt)) {
      newArr = selectedArray.filter(v => v !== opt);
    } else {
      newArr = [...selectedArray, opt];
    }
    onChange(newArr.length > 0 ? newArr.join(',') : 'ALL');
  };

  return (
    <div ref={ref} style={{ display: 'flex', flexDirection: 'column', gap: '5px', position: 'relative', minWidth: '160px' }}>
      <label style={{ fontWeight: 'bold', color: 'var(--grupamar-azul-oscuro)', fontSize: '13px' }}>{label}</label>
      <div 
        onClick={() => setIsOpen(!isOpen)}
        style={{ 
          borderRadius: '30px', padding: '10px 15px', border: '1px solid #ccc', 
          backgroundColor: '#fff', cursor: 'pointer',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center'
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '130px', fontSize: '14px' }}>
          {selectedArray.length === 0 ? 'Todos' : (selectedArray.length === 1 ? selectedArray[0] : `${selectedArray.length} selec.`)}
        </span>
        <span style={{ fontSize: '10px', marginLeft: '10px', color: '#666' }}>▼</span>
      </div>
      
      {isOpen && (
        <div style={{ 
          position: 'absolute', top: '100%', left: 0, zIndex: 10, 
          backgroundColor: '#fff', border: '1px solid #ccc', borderRadius: '10px', 
          marginTop: '5px', maxHeight: '250px', overflowY: 'auto',
          boxShadow: '0 4px 6px rgba(0,0,0,0.1)', minWidth: '100%'
        }}>
          <div 
            onClick={() => toggleOption('ALL')}
            style={{ padding: '8px 15px', cursor: 'pointer', borderBottom: '1px solid #eee', backgroundColor: selectedArray.length === 0 ? '#f0f8ff' : '#fff', fontSize: '14px' }}
          >
            <input type="checkbox" checked={selectedArray.length === 0} readOnly style={{ marginRight: '8px' }} />
            Todos
          </div>
          {options.map(opt => (
            <div 
              key={opt}
              onClick={() => toggleOption(opt)}
              style={{ padding: '8px 15px', cursor: 'pointer', borderBottom: '1px solid #eee', backgroundColor: selectedArray.includes(opt) ? '#f0f8ff' : '#fff', fontSize: '14px' }}
            >
              <input type="checkbox" checked={selectedArray.includes(opt)} readOnly style={{ marginRight: '8px' }} />
              {opt}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

function App() {
  const [hasData, setHasData] = useState(false);
  const [records, setRecords] = useState([]); // Will hold the filtered subset
  const [analysisFilters, setAnalysisFilters] = useState(defaultFilterState);
  const [treeFilters, setTreeFilters] = useState(defaultFilterState);
  const [isPending, startTransition] = useTransition();
  const [isLoading, setIsLoading] = useState(false);
  const [googleSheetUrl, setGoogleSheetUrl] = useState("");
  const [gaussPct, setGaussPct] = useState(100);
  const [tempGaussPct, setTempGaussPct] = useState(100);
  const [activeTab, setActiveTab] = useState('ANALISIS');
  const [dynamicColumns, setDynamicColumns] = useState([]);
  const [savedTreesList, setSavedTreesList] = useState([]);
  const [hiddenNodePaths, setHiddenNodePaths] = useState([]);
  const initialFixedFilters = [
    { key: 'plazaOrigen', name: 'Plaza Origen', dbKey: 'PlazaOrigen' },
    { key: 'fasePadre', name: 'Fase Padre', dbKey: 'FasePadre' },
    { key: 'fase', name: 'Fase', dbKey: 'Fase' },
    { key: 'plazaDestino', name: 'Plaza Destino', dbKey: 'PlazaDestino' },
    { key: 'zonaDestino', name: 'Zona Destino', dbKey: 'ZonaDestino' },
    { key: 'dia', name: 'Día Expedición', dbKey: 'Dia' },
    { key: 'adr', name: 'ADR', dbKey: 'ADR' }
  ];
  const [filterOrder, setFilterOrder] = useState(initialFixedFilters);
  const [draggedItemIdx, setDraggedItemIdx] = useState(null);

  useEffect(() => {
    setFilterOrder(prev => {
      const newOrder = [...prev];
      let changed = false;
      dynamicColumns.forEach(col => {
        if (!newOrder.find(f => f.key === col)) {
          newOrder.push({ key: col, name: col, dbKey: col });
          changed = true;
        }
      });
      return changed ? newOrder : prev;
    });
  }, [dynamicColumns]);

  const handleDragStart = (e, index) => {
    setDraggedItemIdx(index);
    e.dataTransfer.effectAllowed = 'move';
    e.target.style.opacity = '0.5';
  };

  const handleDragEnd = (e) => {
    e.target.style.opacity = '1';
    setDraggedItemIdx(null);
  };

  const handleDragOver = (e, index) => {
    e.preventDefault();
  };

  const handleDrop = (e, targetIndex) => {
    e.preventDefault();
    if (draggedItemIdx === null || draggedItemIdx === targetIndex) return;
    const newOrder = [...filterOrder];
    const draggedItem = newOrder[draggedItemIdx];
    newOrder.splice(draggedItemIdx, 1);
    newOrder.splice(targetIndex, 0, draggedItem);
    setFilterOrder(newOrder);
  };

  const [pendingColumns, setPendingColumns] = useState(null);
  const [selectedPendingColumns, setSelectedPendingColumns] = useState([]);
  
  const [analysisDbOptions, setAnalysisDbOptions] = useState({
    FasePadre: [], Fase: [], PlazaOrigen: [], PlazaDestino: [], ZonaDestino: [], Dia: [], ADR: []
  });
  const [treeDbOptions, setTreeDbOptions] = useState({
    FasePadre: [], Fase: [], PlazaOrigen: [], PlazaDestino: [], ZonaDestino: [], Dia: [], ADR: []
  });

  const fileInputRef = useRef(null);
  
  const buildWhereClause = (currentFilters, excludeField = null, dynCols = dynamicColumns) => {
    let clauses = [];
    if (currentFilters.excluirCeros) clauses.push(`DuracionMinutos > 0`);
    
    const addInClause = (field, filterKey) => {
      const val = currentFilters[filterKey];
      if (field !== excludeField && val && val !== 'ALL') {
         const list = val.split(',').map(v => `'${v.replace(/'/g, "''")}'`).join(',');
         clauses.push(`"${field}" IN (${list})`);
      }
    };
    
    addInClause('ZonaOrigen', 'zonaOrigen');
    addInClause('PlazaOrigen', 'plazaOrigen');
    addInClause('ZonaDestino', 'zonaDestino');
    addInClause('PlazaDestino', 'plazaDestino');
    addInClause('FasePadre', 'fasePadre');
    addInClause('Fase', 'fase');
    addInClause('ADR', 'adr');
    addInClause('Completo', 'completo');
    addInClause('Dia', 'dia');
    
    dynCols.forEach(col => addInClause(col, col));

    return clauses.length > 0 ? 'WHERE ' + clauses.join(' AND ') : '';
  };
  
  const getFilteredUniqueValues = async (field, currentFilters, dynCols = dynamicColumns) => {
      const where = buildWhereClause(currentFilters, field, dynCols);
      const query = `SELECT DISTINCT "${field}" as val FROM records ${where} ${where ? 'AND' : 'WHERE'} "${field}" IS NOT NULL AND CAST("${field}" AS VARCHAR) != '' ORDER BY val`;
      const result = await executeQuery(query);
      return result.map(r => r.val);
  };

  const updateDependentOptions = async (currentFilters, dynCols = dynamicColumns) => {
    try {
      const fixedPromises = [
        getFilteredUniqueValues('FasePadre', currentFilters, dynCols),
        getFilteredUniqueValues('Fase', currentFilters, dynCols),
        getFilteredUniqueValues('PlazaOrigen', currentFilters, dynCols),
        getFilteredUniqueValues('PlazaDestino', currentFilters, dynCols),
        getFilteredUniqueValues('ZonaDestino', currentFilters, dynCols),
        getFilteredUniqueValues('Dia', currentFilters, dynCols),
        getFilteredUniqueValues('ADR', currentFilters, dynCols)
      ];
      
      const dynPromises = dynCols.map(col => getFilteredUniqueValues(col, currentFilters, dynCols));
      
      const results = await Promise.all([...fixedPromises, ...dynPromises]);
      
      const [fasePadre, fase, plazaOrigen, plazaDestino, zonaDestino, dia, adr] = results.slice(0, 7);
      const dynResults = results.slice(7);
      
      const diasSemana = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
      dia.sort((a, b) => {
        const ia = diasSemana.indexOf(a);
        const ib = diasSemana.indexOf(b);
        return (ia > -1 ? ia : 99) - (ib > -1 ? ib : 99);
      });

      const newDbOptions = { FasePadre: fasePadre, Fase: fase, PlazaOrigen: plazaOrigen, PlazaDestino: plazaDestino, ZonaDestino: zonaDestino, Dia: dia, ADR: adr };
      dynCols.forEach((col, idx) => {
         newDbOptions[col] = dynResults[idx];
      });

      return newDbOptions;
    } catch (e) {
      console.error("Error fetching options", e);
      return null;
    }
  };

  const executeFilteredQuery = async (currentFilters, dynCols = dynamicColumns) => {
    const where = buildWhereClause(currentFilters, null, dynCols);
    const query = `SELECT NumPartidas, DuracionMinutos, Fase, ADR, Dia_Binario FROM records ${where}`;
    
    setIsLoading(true);
    try {
      const result = await executeQuery(query);
      setRecords(result);
      const newDbOptions = await updateDependentOptions(currentFilters, dynCols);
      if (newDbOptions) setAnalysisDbOptions(newDbOptions);
    } catch (e) {
      console.error(e);
      alert("Error ejecutando filtro SQL");
    } finally {
      setIsLoading(false);
    }
  };

  const handleFileUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsLoading(true);
    try {
      await loadDataFromFile(file);
      const dynCols = await getDynamicColumns();
      
      if (dynCols.length > 0) {
        setPendingColumns(dynCols);
        setSelectedPendingColumns(dynCols);
      } else {
        setDynamicColumns([]);
        const initialFilters = { ...defaultFilterState };
        setHasData(true);
        setAnalysisFilters(initialFilters);
        setTreeFilters(initialFilters);
        await executeFilteredQuery(initialFilters, []);
        const newTreeOpts = await updateDependentOptions(initialFilters, []);
        if (newTreeOpts) setTreeDbOptions(newTreeOpts);
      }
    } catch (err) {
      alert(`Error procesando archivo: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleFetchGoogleSheet = async () => {
    if (!googleSheetUrl) return;
    setIsLoading(true);
    try {
      await loadDataFromURL(googleSheetUrl);
      const dynCols = await getDynamicColumns();
      
      if (dynCols.length > 0) {
        setPendingColumns(dynCols);
        setSelectedPendingColumns(dynCols);
      } else {
        setDynamicColumns([]);
        const initialFilters = { ...defaultFilterState };
        setHasData(true);
        setAnalysisFilters(initialFilters);
        setTreeFilters(initialFilters);
        await executeFilteredQuery(initialFilters, []);
        const newTreeOpts = await updateDependentOptions(initialFilters, []);
        if (newTreeOpts) setTreeDbOptions(newTreeOpts);
      }
    } catch (err) {
      alert(`Error obteniendo datos: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleConfirmColumns = async () => {
    setDynamicColumns(selectedPendingColumns);
    const initialFilters = { ...defaultFilterState };
    selectedPendingColumns.forEach(col => initialFilters[col] = 'ALL');
    
    setHasData(true);
    setAnalysisFilters(initialFilters);
    setTreeFilters(initialFilters);
    await executeFilteredQuery(initialFilters, selectedPendingColumns);
    const newTreeOpts = await updateDependentOptions(initialFilters, selectedPendingColumns);
    if (newTreeOpts) setTreeDbOptions(newTreeOpts);
    setPendingColumns(null);
  };

  const handleFilterChange = (key, val) => {
    if (activeTab === 'ANALISIS') {
      const newFilters = { ...analysisFilters, [key]: val };
      setAnalysisFilters(newFilters);
      startTransition(() => {
        executeFilteredQuery(newFilters);
      });
    } else {
      const newFilters = { ...treeFilters, [key]: val };
      setTreeFilters(newFilters);
      startTransition(async () => {
        setIsLoading(true);
        const newDbOptions = await updateDependentOptions(newFilters, dynamicColumns);
        if (newDbOptions) setTreeDbOptions(newDbOptions);
        setIsLoading(false);
      });
    }
  };

  // Pareto Keys calculation (Top N%)
  const paretoKeys = useMemo(() => {
    if (records.length === 0) return new Set();
    const counts = {};
    records.forEach(r => {
      const p = r.NumPartidas;
      if (!counts[p]) counts[p] = 0;
      counts[p]++;
    });
    
    const sortedEntries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    const threshold = records.length * (gaussPct / 100);
    let currentSum = 0;
    const keys = new Set();
    
    for (const [key, count] of sortedEntries) {
      if (currentSum < threshold) {
        keys.add(Number(key));
        currentSum += count;
      }
    }
    return keys;
  }, [records, gaussPct]);

  const paretoRecords = useMemo(() => records.filter(r => paretoKeys.has(r.NumPartidas)), [records, paretoKeys]);

  const stats = useMemo(() => {
    const durations = paretoRecords.map(r => r.DuracionMinutos);
    return calculateTukeyStats(durations);
  }, [paretoRecords]);

  const cleanRecords = useMemo(() => paretoRecords.filter(r => r.DuracionMinutos <= stats.LimiteTukey), [paretoRecords, stats.LimiteTukey]);
  
  const statsPorFase = useMemo(() => {
    if (paretoRecords.length === 0) return [];
    const groups = {};
    for (let i = 0; i < paretoRecords.length; i++) {
      const r = paretoRecords[i];
      if (!groups[r.Fase]) groups[r.Fase] = [];
      groups[r.Fase].push(r.DuracionMinutos);
    }
    return Object.keys(groups).sort().map(fase => ({
      fase,
      count: groups[fase].length,
      stats: calculateTukeyStats(groups[fase])
    }));
  }, [paretoRecords]);

  const { regressionSi, regressionNo } = useMemo(() => {
    const recordsAdrSi = cleanRecords.filter(r => r.ADR === 'SI');
    const recordsAdrNo = cleanRecords.filter(r => r.ADR === 'NO');
    return {
      regressionSi: fitOLS(recordsAdrSi),
      regressionNo: fitOLS(recordsAdrNo)
    };
  }, [cleanRecords]);

  const partidasData = useMemo(() => {
    const groups = {};
    paretoRecords.forEach(r => {
      const p = r.NumPartidas;
      if (!groups[p]) groups[p] = [];
      groups[p].push(r.DuracionMinutos);
    });
    return Object.keys(groups)
      .map(Number)
      .sort((a, b) => a - b)
      .map(p => {
        const stats = calculateTukeyStats(groups[p]);
        return {
          partidas: p,
          expediciones: groups[p].length,
          tiempoMedio: stats.Mediana.toFixed(2),
          mejor: stats.Q1.toFixed(2),
          peor: stats.MaxLimpio.toFixed(2)
        };
      });
  }, [paretoRecords]);

  const histogramData = useMemo(() => {
    if (records.length === 0) return [];
    const counts = {};
    records.forEach(r => {
      const p = r.NumPartidas;
      if (!counts[p]) counts[p] = 0;
      counts[p]++;
    });

    const keysNum = Object.keys(counts).map(Number);
    const minX = Math.floor(keysNum.reduce((min, v) => (v < min ? v : min), keysNum[0]));
    const maxX = Math.ceil(keysNum.reduce((max, v) => (v > max ? v : max), keysNum[0]));
    
    const data = [];
    for (let x = minX; x <= maxX; x++) {
      const count = counts[x] || 0;
      data.push({
        x,
        y: count,
        yFiltered: paretoKeys.has(x) ? count : 0
      });
    }
    return data;
  }, [records, paretoKeys]);

  const treeData = useMemo(() => {
    const activeLevels = filterOrder.filter(lvl => treeFilters[lvl.key] && treeFilters[lvl.key] !== 'ALL');

    if (activeLevels.length === 0) {
      return [{ name: 'Filtros Inactivos', attributes: { Info: 'Selecciona al menos un filtro para ver la rama' } }];
    }

    const buildNodes = (levelIndex, parentPath = []) => {
      if (levelIndex >= activeLevels.length) return undefined;
      const currentLevel = activeLevels[levelIndex];
      const selectedValues = treeFilters[currentLevel.key].split(',');
      
      const nodes = [];
      for (const val of selectedValues) {
         const currentPath = [...parentPath, val];
         const pathKey = currentPath.join('|||');
         
         if (hiddenNodePaths && hiddenNodePaths.includes(pathKey)) continue;

         const node = { 
            name: val, 
            attributes: { Nivel: currentLevel.name },
            pathKey 
         };
         
         const children = buildNodes(levelIndex + 1, currentPath);
         if (children && children.length > 0) {
            node.children = children;
         }
         nodes.push(node);
      }
      return nodes;
    };

    const builtTree = buildNodes(0);
    if (!builtTree || builtTree.length === 0) {
      return [{ name: 'Vacío', attributes: { Info: 'Todas las ramas han sido podadas.' } }];
    }
    return builtTree;
  }, [treeFilters, filterOrder, hiddenNodePaths]);

  const handlePruneNode = (pathKey) => {
    setHiddenNodePaths(prev => [...prev, pathKey]);
  };

  const renderCustomNodeElement = ({ nodeDatum, toggleNode }) => (
    <g>
      <circle r="20" fill="var(--grupamar-azul-claro)" onClick={toggleNode} style={{ cursor: 'pointer' }} />
      <text fill="#fff" x="-10" y="5" onClick={toggleNode} style={{ cursor: 'pointer', fontWeight: 'bold', fontSize: '14px', fontFamily: 'Arial, sans-serif' }}>
        {String(nodeDatum.name || '').substring(0, 2).toUpperCase()}
      </text>
      <text fill="#333" x="25" y="-5" style={{ fontWeight: 'bold', fontSize: '14px', fontFamily: 'Arial, sans-serif' }}>
        {nodeDatum.name}
      </text>
      {nodeDatum.attributes?.Nivel && (
        <text fill="#666" x="25" y="15" style={{ fontSize: '12px', fontFamily: 'Arial, sans-serif' }}>
          {nodeDatum.attributes.Nivel}
        </text>
      )}
      {nodeDatum.pathKey && (
        <g transform="translate(-10, -35)" onClick={() => handlePruneNode(nodeDatum.pathKey)} style={{ cursor: 'pointer' }}>
          <circle r="10" fill="var(--grupamar-naranja)" />
          <text fill="#fff" x="-4.5" y="4.5" fontSize="14px" fontWeight="bold">✕</text>
          <title>Podar rama</title>
        </g>
      )}
    </g>
  );

  const handleSaveTree = async () => {
    const name = prompt("Introduce un nombre para guardar esta ramificación:");
    if (!name) return;
    
    try {
      setIsLoading(true);
      await addDoc(collection(db, "savedTrees"), {
        name,
        treeFilters,
        filterOrder,
        hiddenNodePaths,
        createdAt: new Date()
      });
      alert("Ramificación guardada exitosamente en Firebase!");
    } catch (e) {
      console.error("Error guardando ramificación: ", e);
      alert("Hubo un error al guardar.");
    } finally {
      setIsLoading(false);
      fetchSavedTrees();
    }
  };

  const fetchSavedTrees = async () => {
    try {
      const querySnapshot = await getDocs(collection(db, "savedTrees"));
      const trees = [];
      querySnapshot.forEach((doc) => {
        trees.push({ id: doc.id, ...doc.data() });
      });
      setSavedTreesList(trees.sort((a, b) => b.createdAt?.toMillis() - a.createdAt?.toMillis()));
    } catch (e) {
      console.error("Error fetching saved trees", e);
    }
  };

  useEffect(() => {
    if (activeTab === 'RAMIFICACIONES') {
      fetchSavedTrees();
    }
  }, [activeTab]);

  const handleLoadTree = (tree) => {
    setFilterOrder(tree.filterOrder);
    setTreeFilters(tree.treeFilters);
    setHiddenNodePaths(tree.hiddenNodePaths || []);
    setIsLoading(true);
    updateDependentOptions(tree.treeFilters, dynamicColumns).then(newOpts => {
      if (newOpts) setTreeDbOptions(newOpts);
      setIsLoading(false);
    });
  };

  const handleDeleteTree = async (id) => {
    if (!confirm("¿Seguro que deseas eliminar esta ramificación?")) return;
    try {
      setIsLoading(true);
      await deleteDoc(doc(db, "savedTrees", id));
      await fetchSavedTrees();
      alert("Ramificación eliminada.");
    } catch (e) {
      console.error("Error eliminando: ", e);
      alert("Hubo un error al eliminar.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div style={{ fontFamily: 'var(--font-grupamar)', backgroundColor: '#ffffff', minHeight: '100vh' }}>
      
      {/* Header Full Width */}
      <div style={{ 
        backgroundColor: 'var(--grupamar-azul-oscuro)', 
        padding: '20px 40px', 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'center',
        position: 'relative',
        marginBottom: '30px',
        boxShadow: '0 4px 6px rgba(0,0,0,0.1)'
      }}>
        <img src="/grupamar-logo.png" alt="GrupaMar" style={{ height: '45px', position: 'absolute', left: '40px' }} />
        <h1 style={{ color: '#ffffff', fontSize: '28px', margin: 0, fontWeight: 'bold' }}>Tiempos de Servicios</h1>
      </div>

      <div style={{ padding: '0 40px 40px 40px' }}>
      
      {/* Data Load Area */}
      {!hasData && pendingColumns === null && (
        <div className="card" style={{ marginBottom: '30px', display: 'flex', flexDirection: 'column', gap: '20px', backgroundColor: 'var(--grupamar-gris-claro)', border: 'none' }}>
          <h3 style={{ color: 'var(--grupamar-azul-oscuro)', margin: 0 }}>Carga los datos aquí Por favor</h3>
          <div style={{ display: 'flex', gap: '15px', alignItems: 'center', flexWrap: 'wrap' }}>
            <input type="file" accept=".csv" onChange={handleFileUpload} ref={fileInputRef} style={{ display: 'none' }} />
            <button onClick={() => fileInputRef.current?.click()} style={{ padding: '12px 30px', borderRadius: '30px', border: 'none', backgroundColor: 'var(--grupamar-azul-oscuro)', color: '#fff', cursor: 'pointer', fontWeight: 'bold' }}>
              Cargar Archivo CSV Local
            </button>
            <span style={{ fontWeight: 'bold', color: 'var(--grupamar-azul-oscuro)' }}>ó</span>
            <input 
              type="text" 
              placeholder="Pega el enlace público de Google Sheet..." 
              value={googleSheetUrl}
              onChange={(e) => setGoogleSheetUrl(e.target.value)}
              style={{ flex: '1', minWidth: '250px', borderRadius: '30px', padding: '12px 20px', border: '1px solid #ccc' }}
            />
            <button onClick={handleFetchGoogleSheet} style={{ padding: '12px 30px', borderRadius: '30px', border: 'none', backgroundColor: 'var(--grupamar-azul-claro)', color: '#fff', cursor: 'pointer', fontWeight: 'bold' }}>
              Obtener Datos
            </button>
          </div>
          {isLoading && <span style={{ color: 'var(--grupamar-naranja)', fontWeight: 'bold' }}>Procesando Datos, Espere...</span>}
        </div>
      )}

      {/* Pending Columns Selection Area */}
      {!hasData && pendingColumns !== null && (
        <div className="card" style={{ marginBottom: '30px', display: 'flex', flexDirection: 'column', gap: '20px', backgroundColor: 'var(--grupamar-gris-claro)', border: 'none' }}>
          <h3 style={{ color: 'var(--grupamar-azul-oscuro)', margin: 0 }}>Nuevas columnas encontradas</h3>
          <p style={{ margin: 0, color: '#444' }}>Se detectaron las siguientes columnas adicionales. Selecciona cuáles quieres utilizar como filtros:</p>
          
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '15px' }}>
            {pendingColumns.map(col => (
              <label key={col} style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', padding: '10px 15px', backgroundColor: '#fff', borderRadius: '20px', border: '1px solid #ccc', fontWeight: 'bold', color: 'var(--grupamar-azul-oscuro)', fontSize: '14px' }}>
                <input 
                  type="checkbox" 
                  checked={selectedPendingColumns.includes(col)}
                  onChange={(e) => {
                    if (e.target.checked) {
                      setSelectedPendingColumns([...selectedPendingColumns, col]);
                    } else {
                      setSelectedPendingColumns(selectedPendingColumns.filter(c => c !== col));
                    }
                  }}
                  style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                />
                {col}
              </label>
            ))}
          </div>

          <div style={{ marginTop: '10px' }}>
            <button onClick={handleConfirmColumns} style={{ padding: '12px 30px', borderRadius: '30px', border: 'none', backgroundColor: 'var(--grupamar-azul-oscuro)', color: '#fff', cursor: 'pointer', fontWeight: 'bold' }}>
              Continuar y Analizar
            </button>
          </div>
          {isLoading && <span style={{ color: 'var(--grupamar-naranja)', fontWeight: 'bold' }}>Procesando Datos, Espere...</span>}
        </div>
      )}

      {hasData && (
        <>
          {/* Filters Area */}
          <div className="card" style={{ display: 'flex', gap: '20px', flexWrap: 'wrap', marginBottom: '20px', backgroundColor: 'var(--grupamar-gris-claro)', border: 'none', alignItems: 'flex-end', position: 'relative' }}>
            {filterOrder.map((fItem, index) => (
              <div 
                key={fItem.key}
                draggable
                onDragStart={(e) => handleDragStart(e, index)}
                onDragEnd={handleDragEnd}
                onDragOver={(e) => handleDragOver(e, index)}
                onDrop={(e) => handleDrop(e, index)}
                style={{ cursor: 'grab' }}
                title="Arrastra para reordenar"
              >
                <MultiSelectCheckbox 
                  label={`${fItem.name}:`} 
                  options={(activeTab === 'ANALISIS' ? analysisDbOptions : treeDbOptions)[fItem.dbKey] || []} 
                  value={(activeTab === 'ANALISIS' ? analysisFilters : treeFilters)[fItem.key] || 'ALL'} 
                  onChange={(val) => handleFilterChange(fItem.key, val)} 
                />
              </div>
            ))}
            
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontWeight: 'bold', color: 'var(--grupamar-azul-oscuro)', fontSize: '13px', marginLeft: '10px', paddingBottom: '10px' }}>
              <input 
                type="checkbox" 
                checked={(activeTab === 'ANALISIS' ? analysisFilters : treeFilters).excluirCeros} 
                onChange={(e) => handleFilterChange('excluirCeros', e.target.checked)} 
                style={{ width: '18px', height: '18px', cursor: 'pointer' }}
              />
              Excluir 0 minutos
            </label>

            {(isPending || isLoading) && <span style={{ position: 'absolute', top: '10px', right: '20px', color: 'var(--grupamar-naranja)', fontWeight: 'bold', fontSize: '12px' }}>Ejecutando SQL...</span>}

            <button onClick={() => { 
                const resetFilters = { ...defaultFilterState };
                dynamicColumns.forEach(c => resetFilters[c] = 'ALL');
                if (activeTab === 'ANALISIS') {
                  setAnalysisFilters(resetFilters); 
                  executeFilteredQuery(resetFilters); 
                } else {
                  setTreeFilters(resetFilters);
                  setIsLoading(true);
                  updateDependentOptions(resetFilters, dynamicColumns).then(newOpts => {
                    if (newOpts) setTreeDbOptions(newOpts);
                    setIsLoading(false);
                  });
                }
              }} style={{ padding: '10px 20px', borderRadius: '30px', border: '1px solid var(--grupamar-azul-oscuro)', backgroundColor: 'transparent', color: 'var(--grupamar-azul-oscuro)', cursor: 'pointer', fontWeight: 'bold', marginLeft: 'auto' }}>
              Limpiar Filtros
            </button>
          </div>

          <div style={{ display: 'flex', gap: '10px', marginBottom: '20px', borderBottom: '2px solid var(--grupamar-azul-oscuro)' }}>
            <button 
              onClick={() => setActiveTab('ANALISIS')} 
              style={{ padding: '12px 25px', borderRadius: '10px 10px 0 0', border: 'none', backgroundColor: activeTab === 'ANALISIS' ? 'var(--grupamar-azul-oscuro)' : '#e0e0e0', color: activeTab === 'ANALISIS' ? '#fff' : '#444', cursor: 'pointer', fontWeight: 'bold', fontSize: '15px' }}
            >
              Módulo de Análisis
            </button>
            <button 
              onClick={() => setActiveTab('RAMIFICACIONES')} 
              style={{ padding: '12px 25px', borderRadius: '10px 10px 0 0', border: 'none', backgroundColor: activeTab === 'RAMIFICACIONES' ? 'var(--grupamar-azul-oscuro)' : '#e0e0e0', color: activeTab === 'RAMIFICACIONES' ? '#fff' : '#444', cursor: 'pointer', fontWeight: 'bold', fontSize: '15px' }}
            >
              Módulo de Ramificaciones
            </button>
            
            {activeTab === 'RAMIFICACIONES' && (
              <button onClick={handleSaveTree} style={{ padding: '10px 20px', backgroundColor: 'var(--grupamar-naranja)', color: '#fff', border: 'none', borderRadius: '30px', cursor: 'pointer', fontWeight: 'bold', marginLeft: 'auto' }}>
                Guardar Ramificación
              </button>
            )}
          </div>

          {activeTab === 'ANALISIS' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
                {/* Tukey Stats */}
                <div className="card" style={{ flex: '1 1 300px' }}>
                  <h3 style={{ color: 'var(--grupamar-azul-claro)', marginBottom: '15px' }}>Estadísticas</h3>
                  <p>Total Registros: <b>{stats.Total}</b></p>
                  <p>Limpios: <b>{stats.Limpios}</b> ({stats.PctLimpios}%)</p>
                  <p>Aberrantes: <b>{stats.Aberrantes}</b> ({stats.PctAberrantes}%)</p>
                  <p>Límite Tukey: <b>{stats.LimiteTukey.toFixed(2)} min</b></p>


                  <hr style={{ margin: '20px 0', border: 'none', borderTop: '1px solid #ddd' }} />
                  <h3 style={{ color: 'var(--grupamar-azul-claro)', marginBottom: '15px' }}>Relación</h3>
                  
                  <div style={{ marginBottom: '10px' }}>
                    <p style={{ margin: '0 0 5px 0' }}><b>Con ADR (SI):</b></p>
                    <p style={{ margin: '0', paddingLeft: '10px' }}>Coef. Correlación (R²): <b>{regressionSi ? (regressionSi.R2 * 100).toFixed(2) + '%' : 'N/A (Faltan datos)'}</b></p>
                    <p style={{ margin: '0', paddingLeft: '10px', color: regressionSi ? (regressionSi.R2 > 0.5 ? 'green' : 'red') : '#888', fontWeight: 'bold' }}>
                      {regressionSi ? (regressionSi.R2 > 0.5 ? "Sí guarda relación (Fuerte)" : "No guarda relación (Débil)") : "-"}
                    </p>
                  </div>

                  <div>
                    <p style={{ margin: '0 0 5px 0' }}><b>Sin ADR (NO):</b></p>
                    <p style={{ margin: '0', paddingLeft: '10px' }}>Coef. Correlación (R²): <b>{regressionNo ? (regressionNo.R2 * 100).toFixed(2) + '%' : 'N/A (Faltan datos)'}</b></p>
                    <p style={{ margin: '0', paddingLeft: '10px', color: regressionNo ? (regressionNo.R2 > 0.5 ? 'green' : 'red') : '#888', fontWeight: 'bold' }}>
                      {regressionNo ? (regressionNo.R2 > 0.5 ? "Sí guarda relación (Fuerte)" : "No guarda relación (Débil)") : "-"}
                    </p>
                  </div>
                </div>

                {/* Middle Panel: Resumen de Tiempos */}
                <div className="card" style={{ flex: '1 1 auto', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                  <h3 style={{ color: 'var(--grupamar-azul-claro)', marginBottom: '15px', textAlign: 'center' }}>Resumen de Tiempos</h3>
                  <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'center' }}>
                    <thead>
                      <tr style={{ borderBottom: '2px solid var(--grupamar-azul-oscuro)', color: 'var(--grupamar-azul-oscuro)' }}>
                        <th style={{ padding: '10px 20px' }}>Nivel</th>
                        <th style={{ padding: '10px 20px' }}>Mejor de los casos</th>
                        <th style={{ padding: '10px 20px' }}>Casos comunes</th>
                        <th style={{ padding: '10px 20px' }}>Peor de los casos</th>
                      </tr>
                    </thead>
                    <tbody>
                      {statsPorFase.length > 1 && (
                        <tr style={{ backgroundColor: '#e6f7ff', borderBottom: '2px solid #ccc' }}>
                          <td style={{ padding: '20px 10px', fontWeight: 'bold', fontSize: '18px', color: 'var(--grupamar-azul-oscuro)' }}>General</td>
                          <td style={{ padding: '20px 10px', color: 'green', fontWeight: 'bold', fontSize: '20px' }}>{stats.Q1.toFixed(2)} <span style={{ fontSize: '14px', color: '#666', fontWeight: 'normal' }}>min</span></td>
                          <td style={{ padding: '20px 10px', color: 'var(--grupamar-naranja)', fontWeight: 'bold', fontSize: '20px' }}>{stats.Mediana.toFixed(2)} <span style={{ fontSize: '14px', color: '#666', fontWeight: 'normal' }}>min</span></td>
                          <td style={{ padding: '20px 10px', color: 'red', fontWeight: 'bold', fontSize: '20px' }}>{stats.MaxLimpio.toFixed(2)} <span style={{ fontSize: '14px', color: '#666', fontWeight: 'normal' }}>min</span></td>
                        </tr>
                      )}
                      {statsPorFase.map((item, idx) => (
                        <tr key={idx} style={{ borderBottom: '1px solid #eee' }}>
                          <td style={{ padding: '12px 10px', textAlign: 'left', paddingLeft: '20px' }}>
                            <div style={{ fontWeight: 'bold', color: 'var(--grupamar-azul-oscuro)', fontSize: '14px' }}>{item.fase}</div>
                          </td>
                          <td style={{ padding: '12px 10px', color: 'green', fontWeight: 'bold', fontSize: '16px' }}>{item.stats.Q1.toFixed(2)} <span style={{ fontSize: '12px', color: '#666', fontWeight: 'normal' }}>min</span></td>
                          <td style={{ padding: '12px 10px', color: 'var(--grupamar-naranja)', fontWeight: 'bold', fontSize: '16px' }}>{item.stats.Mediana.toFixed(2)} <span style={{ fontSize: '12px', color: '#666', fontWeight: 'normal' }}>min</span></td>
                          <td style={{ padding: '12px 10px', color: 'red', fontWeight: 'bold', fontSize: '16px' }}>{item.stats.MaxLimpio.toFixed(2)} <span style={{ fontSize: '12px', color: '#666', fontWeight: 'normal' }}>min</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Histogram Chart */}
                <div className="card" style={{ flex: '2 1 500px' }}>
                  <h3 style={{ color: 'var(--grupamar-azul-claro)', marginBottom: '5px' }}>Histograma de Expediciones por Partidas</h3>
                  <p style={{ fontSize: '14px', marginBottom: '15px', color: '#666' }}>
                    Muestra la cantidad de expediciones reales. El filtro sombrea los N números de partidas más frecuentes que en conjunto suman el {gaussPct}% de todas tus expediciones (Filtro Pareto).
                  </p>
                  
                  <div style={{ marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '15px' }}>
                    <span style={{ fontWeight: 'bold' }}>Filtro de porcentaje:</span>
                    <input 
                      type="range" 
                      min="1" 
                      max="100" 
                      value={tempGaussPct} 
                      onChange={(e) => setTempGaussPct(Number(e.target.value))} 
                      onPointerUp={(e) => setGaussPct(Number(e.target.value))}
                      style={{ flex: '1' }}
                    />
                    <input 
                      type="number" 
                      min="1" 
                      max="100" 
                      value={tempGaussPct} 
                      onChange={(e) => {
                        const val = Number(e.target.value);
                        setTempGaussPct(val);
                        startTransition(() => {
                          setGaussPct(val);
                        });
                      }} 
                      style={{ width: '60px', padding: '5px', borderRadius: '5px', border: '1px solid #ccc', fontWeight: 'bold', color: 'var(--grupamar-azul-oscuro)', textAlign: 'center' }}
                    />
                    <span style={{ fontWeight: 'bold', color: 'var(--grupamar-azul-oscuro)' }}>%</span>
                  </div>

                  <div style={{ width: '100%', height: '300px' }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={histogramData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="x" name="Partidas" />
                        <YAxis dataKey="y" name="Expediciones" />
                        <RechartsTooltip 
                          formatter={(value, name, props) => {
                            if (name === "yFiltered") return [value, "Expediciones (Selección Pareto)"];
                            if (name === "y") return [value, "Expediciones (Total)"];
                            return [value, name];
                          }}
                          labelFormatter={(label) => `Partidas: ${label}`}
                        />
                        <Area type="monotone" dataKey="y" stroke="#ccc" fill="#eee" fillOpacity={0.5} isAnimationActive={false} />
                        <Area type="monotone" dataKey="yFiltered" stroke="var(--grupamar-azul-oscuro)" fill="var(--grupamar-azul-claro)" fillOpacity={0.8} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>

              {/* Table Partidas vs Tiempo */}
              <div className="card">
                <h3 style={{ color: 'var(--grupamar-azul-claro)', marginBottom: '15px', textAlign: 'center' }}>Tiempos por Cantidad de Partidas</h3>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'center' }}>
                  <thead>
                    <tr style={{ borderBottom: '2px solid var(--grupamar-azul-oscuro)', color: 'var(--grupamar-azul-oscuro)' }}>
                      <th style={{ padding: '10px' }}>Partidas</th>
                      <th style={{ padding: '10px' }}>Expediciones</th>
                      <th style={{ padding: '10px' }}>Mejor de los casos</th>
                      <th style={{ padding: '10px' }}>Casos comunes</th>
                      <th style={{ padding: '10px' }}>Peor de los casos</th>
                    </tr>
                  </thead>
                  <tbody>
                    {partidasData.map((row, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid #ccc' }}>
                        <td style={{ padding: '10px' }}><b>{row.partidas}</b></td>
                        <td style={{ padding: '10px' }}>{row.expediciones}</td>
                        <td style={{ padding: '10px', color: 'green', fontWeight: 'bold' }}>{row.mejor} <span style={{ fontSize: '12px', color: '#666', fontWeight: 'normal' }}>min</span></td>
                        <td style={{ padding: '10px', color: 'var(--grupamar-naranja)', fontWeight: 'bold' }}>{row.tiempoMedio} <span style={{ fontSize: '12px', color: '#666', fontWeight: 'normal' }}>min</span></td>
                        <td style={{ padding: '10px', color: 'red', fontWeight: 'bold' }}>{row.peor} <span style={{ fontSize: '12px', color: '#666', fontWeight: 'normal' }}>min</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === 'RAMIFICACIONES' && (
            <div style={{ display: 'flex', gap: '20px' }}>
              <div className="card" style={{ flex: '3', height: '600px', backgroundColor: '#fdfdfd', border: '2px dashed #ccc', display: 'flex', flexDirection: 'column' }}>
                <h3 style={{ color: 'var(--grupamar-azul-claro)', marginBottom: '15px', textAlign: 'center' }}>Ramificaciones de Filtros Activos</h3>
                {hiddenNodePaths.length > 0 && (
                  <button onClick={() => setHiddenNodePaths([])} style={{ position: 'absolute', top: '15px', left: '15px', padding: '8px 15px', borderRadius: '20px', border: '1px solid var(--grupamar-naranja)', backgroundColor: '#fff', color: 'var(--grupamar-naranja)', cursor: 'pointer', fontWeight: 'bold', zIndex: 10 }}>
                    ↺ Restaurar {hiddenNodePaths.length} rama(s) podada(s)
                  </button>
                )}
                <div style={{ flex: 1, width: '100%', position: 'relative' }}>
                  <Tree 
                    data={treeData} 
                    orientation="horizontal"
                    pathFunc="step"
                    translate={{ x: 100, y: 250 }}
                    nodeSize={{ x: 450, y: 100 }}
                    separation={{ siblings: 1.2, nonSiblings: 1.5 }}
                    renderCustomNodeElement={renderCustomNodeElement}
                  />
                </div>
              </div>
              
              {/* Panel Lateral: Árboles Guardados */}
              <div className="card" style={{ flex: '1', height: '600px', overflowY: 'auto', backgroundColor: '#f9f9f9', display: 'flex', flexDirection: 'column' }}>
                <h3 style={{ color: 'var(--grupamar-azul-oscuro)', marginBottom: '15px', textAlign: 'center' }}>Ramificaciones Guardadas</h3>
                {savedTreesList.length === 0 ? (
                  <p style={{ textAlign: 'center', color: '#888', fontStyle: 'italic', marginTop: '20px' }}>No hay ramificaciones guardadas.</p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {savedTreesList.map((tree) => (
                      <div key={tree.id} style={{ backgroundColor: '#fff', border: '1px solid #ddd', borderRadius: '10px', padding: '15px', boxShadow: '0 2px 4px rgba(0,0,0,0.05)', position: 'relative' }}>
                        <button 
                          onClick={() => handleDeleteTree(tree.id)} 
                          style={{ position: 'absolute', top: '10px', right: '10px', background: 'transparent', border: 'none', color: 'red', cursor: 'pointer', fontSize: '16px' }}
                          title="Eliminar Ramificación"
                        >
                          ✕
                        </button>
                        <h4 style={{ margin: '0 0 5px 0', color: 'var(--grupamar-azul-claro)', paddingRight: '20px' }}>{tree.name}</h4>
                        <p style={{ margin: '0 0 10px 0', fontSize: '12px', color: '#888' }}>
                          {tree.createdAt ? new Date(tree.createdAt.toMillis()).toLocaleString() : 'Sin fecha'}
                        </p>
                        <button 
                          onClick={() => handleLoadTree(tree)}
                          style={{ width: '100%', padding: '8px', backgroundColor: 'var(--grupamar-naranja)', color: '#fff', border: 'none', borderRadius: '5px', cursor: 'pointer', fontWeight: 'bold' }}
                        >
                          Cargar Ramificación
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}
      </div>
    </div>
  );
}

export default App;
