import React, { useEffect, useRef, useState } from 'react';

const DrawioEditor = ({ initialXml, onSave }) => {
  const iframeRef = useRef(null);
  const [isInitialized, setIsInitialized] = useState(false);
  const loadSentRef = useRef(false);

  useEffect(() => {
    const handleMessage = (e) => {
      // Validate origin if possible, but embed.diagrams.net can be from anywhere
      if (!e.data || typeof e.data !== 'string') return;
      
      try {
        const msg = JSON.parse(e.data);
        
        if (msg.event === 'init') {
          // iframe is ready
          setIsInitialized(true);
        } else if (msg.event === 'save' || msg.event === 'autosave') {
          // Draw.io triggers a save or autosave event
          if (onSave) {
            onSave(msg.xml);
          }
        }
      } catch (err) {
        // ignore non-json messages
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [onSave]);

  useEffect(() => {
    if (isInitialized && iframeRef.current && iframeRef.current.contentWindow && !loadSentRef.current) {
      loadSentRef.current = true;
      const xmlToLoad = initialXml || '<mxfile><diagram id="empty" name="Page-1"><mxGraphModel dx="1000" dy="1000" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="827" pageHeight="1169" math="0" shadow="0"><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel></diagram></mxfile>';
      
      setTimeout(() => {
        if (iframeRef.current && iframeRef.current.contentWindow) {
          iframeRef.current.contentWindow.postMessage(JSON.stringify({
            action: 'load',
            autosave: 1,
            xml: xmlToLoad
          }), '*');
        }
      }, 500);
    }
  }, [initialXml, isInitialized]);

  return (
    <iframe
      ref={iframeRef}
      src="https://embed.diagrams.net/?embed=1&ui=min&spin=1&proto=json"
      title="Draw.io Editor"
      style={{
        width: '100%',
        height: '100%',
        border: 'none',
        borderRadius: '10px'
      }}
    />
  );
};

export default DrawioEditor;
