import React, { useState, useRef, useEffect } from 'react';
import { UploadCloud, File as FileIcon, X, Download, Loader2, SlidersHorizontal, Sparkles, CheckCircle, AlertCircle } from 'lucide-react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url';
import { PDFDocument } from 'pdf-lib';
import { cn } from './lib/utils';
import { motion, AnimatePresence } from 'motion/react';

// Require pdf.js worker locally via vite ?url to prevent detached array buffer errors
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export default function App() {
  const [file, setFile] = useState<File | null>(null);
  const [pdfDocument, setPdfDocument] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [originalImageData, setOriginalImageData] = useState<ImageData | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  
  const [intensity, setIntensity] = useState(40); // Slider 0 to 100
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [processedPdfBlob, setProcessedPdfBlob] = useState<Blob | null>(null);
  const [error, setError] = useState<string | null>(null);
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFileSelected(e.dataTransfer.files[0]);
    }
  };

  const removeFile = () => {
    setFile(null);
    setPdfDocument(null);
    setOriginalImageData(null);
    setPreviewUrl(null);
    setProcessedPdfBlob(null);
    setError(null);
    if (fileInputRef.current) {
        fileInputRef.current.value = "";
    }
  };

  const renderPageToImageData = async (pdfDoc: pdfjsLib.PDFDocumentProxy, pageNum: number, scale = 2) => {
    const page = await pdfDoc.getPage(pageNum);
    const viewport = page.getViewport({ scale });
    
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error("No fue posible obtener el contexto del canvas");
    
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    
    // Rellenamos de blanco en caso de que el PDF sea transparente
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    
    await page.render({ canvasContext: context, viewport }).promise;
    return { 
      imageData: context.getImageData(0, 0, canvas.width, canvas.height), 
      width: canvas.width, 
      height: canvas.height 
    };
  };

  const handleFileSelected = async (selectedFile: File) => {
    if (selectedFile.type !== 'application/pdf') {
      setError("Por favor, sube un archivo PDF válido.");
      return;
    }
    setFile(selectedFile);
    setProcessedPdfBlob(null);
    setError(null);
    setPdfDocument(null);
    setOriginalImageData(null);
    setPreviewUrl(null);
    setIntensity(40);

    try {
      const arrayBuffer = await selectedFile.arrayBuffer();
      const pdfData = new Uint8Array(arrayBuffer);
      const loadingTask = pdfjsLib.getDocument({ data: pdfData });
      const pdf = await loadingTask.promise;
      
      if (pdf.numPages === 0) {
          throw new Error("El PDF no tiene páginas.");
      }
      
      setPdfDocument(pdf);
      
      // Renderizamos la priméra página en calidad baja (1.0) para preview rápida
      const { imageData } = await renderPageToImageData(pdf, 1, 1.0);
      setOriginalImageData(imageData);
    } catch (err: any) {
      console.error(err);
      setError(`Error al leer el PDF: ${err.message || "Archivo corrupto o protegido"}`);
      setFile(null);
    }
  };

  // Efecto que actualiza la imagen de la vista previa en base a la intensidad
  useEffect(() => {
    if (!originalImageData) return;
    
    // whitePoint de 255 bajando conforme aumenta la intensidad (hasta ~100)
    const whitePoint = 255 - (intensity * 1.55);
    const factor = 255 / whitePoint;
    
    // Clonamos para no afectar el caché original
    const data = new Uint8ClampedArray(originalImageData.data);
    for (let i = 0; i < data.length; i += 4) {
      // Ajuste de "Puntos Blancos" (Stretching the contrast to eliminate light greys)
      data[i] = Math.min(255, data[i] * factor);     // R
      data[i+1] = Math.min(255, data[i+1] * factor); // G
      data[i+2] = Math.min(255, data[i+2] * factor); // B
    }
    
    const filtered = new ImageData(data, originalImageData.width, originalImageData.height);
    
    const canvas = document.createElement('canvas');
    canvas.width = filtered.width;
    canvas.height = filtered.height;
    const ctx = canvas.getContext('2d');
    ctx?.putImageData(filtered, 0, 0);
    
    // Guardamos Data URL para el <img />
    setPreviewUrl(canvas.toDataURL('image/jpeg', 0.8));
  }, [intensity, originalImageData]);

  const handleProcess = async () => {
    if (!pdfDocument || !file) return;
    setIsProcessing(true);
    setError(null);
    setProgress(0);

    try {
      const outPdf = await PDFDocument.create();
      const whitePoint = 255 - (intensity * 1.55);
      const factor = 255 / whitePoint;

      for (let i = 1; i <= pdfDocument.numPages; i++) {
        // Renderizamos a mayor escala para el PDF de salida final (resolución alta)
        const scale = 2.0; 
        const { imageData, width, height } = await renderPageToImageData(pdfDocument, i, scale);
        
        const data = imageData.data;
        for (let j = 0; j < data.length; j += 4) {
          data[j] = Math.min(255, data[j] * factor);
          data[j+1] = Math.min(255, data[j+1] * factor);
          data[j+2] = Math.min(255, data[j+2] * factor);
        }
        
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx?.putImageData(imageData, 0, 0);
        
        // JPG con buena compresión para no inflar el tamaño demasiado
        const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
        const img = await outPdf.embedJpg(dataUrl);
        
        // Conservamos el ancho y alto del PDF original compensando la escala
        const pdfPageWidth = width / scale;
        const pdfPageHeight = height / scale;
        const page = outPdf.addPage([pdfPageWidth, pdfPageHeight]);
        
        page.drawImage(img, {
          x: 0,
          y: 0,
          width: pdfPageWidth,
          height: pdfPageHeight,
        });
        
        setProgress(Math.round((i / pdfDocument.numPages) * 100));
      }

      const pdfBytes = await outPdf.save();
      const blob = new Blob([pdfBytes], { type: 'application/pdf' });
      setProcessedPdfBlob(blob);
    } catch (err: any) {
      console.error(err);
      setError(`Ocurrió un error al procesar el documento: ${err.message}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const downloadProcessed = () => {
    if (!processedPdfBlob) return;
    const url = URL.createObjectURL(processedPdfBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `limpio_${file?.name || 'documento.pdf'}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-neutral-900 flex items-center justify-center p-4 font-sans text-neutral-900">
      <div className="w-full max-w-4xl bg-white rounded-2xl shadow-2xl overflow-hidden border border-neutral-100 flex flex-col md:flex-row">
        
        {/* Panel lateral decorativo */}
        <div className="bg-blue-600 md:w-1/3 p-8 text-white flex flex-col justify-between relative overflow-hidden shrink-0 hidden md:flex">
          <div className="absolute inset-0 opacity-10 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')] bg-repeat" />
          <div className="relative z-10">
            <div className="w-12 h-12 bg-white/20 backdrop-blur-md rounded-xl flex items-center justify-center mb-6">
              <Sparkles className="w-6 h-6 text-blue-50" />
            </div>
            <h1 className="text-3xl font-bold tracking-tight mb-4">Motor de Limpieza Óptica</h1>
            <p className="text-blue-100 text-sm leading-relaxed mb-6">
              Al tratarse de una marca de agua muy adherida al documento (texto dividido, rotado o con fuentes personalizadas), usaremos un algoritmo de "Ajuste de Punto Blanco" que disuelve la marca de agua visualmente.
            </p>
          </div>
          <div className="relative z-10 text-xs text-blue-200 opacity-80 mt-auto">
            Renderizado por PDF.js v{pdfjsLib.version}<br/>
            Manipulación por PDF-Lib
          </div>
        </div>

        <div className="p-8 md:w-2/3 md:p-10 flex flex-col justify-center">
            
          {/* Cabecera Móvil */}
          <div className="md:hidden pb-6 mb-6 border-b border-neutral-100">
             <h1 className="text-2xl font-bold tracking-tight mb-2">Motor Óptico</h1>
             <p className="text-neutral-500 text-sm">Disuelve inteligentemente correos y marcas superpuestas.</p>
          </div>

          <div className="space-y-6">
            
            {/* Upload Area */}
            {!file ? (
              <div 
                className="border-2 border-dashed border-neutral-300 rounded-xl p-12 text-center hover:bg-neutral-50 hover:border-neutral-400 transition-colors cursor-pointer group"
                onDragOver={handleDragOver}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
              >
                <div className="w-16 h-16 bg-neutral-100 text-neutral-600 rounded-full flex items-center justify-center mx-auto mb-4 group-hover:scale-105 transition-transform duration-300">
                  <UploadCloud className="w-8 h-8" />
                </div>
                <h3 className="text-lg font-medium text-neutral-800 mb-1">Subir documento PDF</h3>
                <p className="text-sm text-neutral-500 mb-4">Arrastra aquí un archivo protegido con marca de agua</p>
                <span className="bg-neutral-900 text-white px-5 py-2.5 rounded-lg text-sm font-medium shadow-sm hover:shadow-md transition-shadow">
                    Seleccionar Archivo
                </span>
                <input 
                  type="file" 
                  ref={fileInputRef} 
                  onChange={(e) => e.target.files && handleFileSelected(e.target.files[0])}
                  className="hidden" 
                  accept="application/pdf"
                />
              </div>
            ) : (
                <div className="border border-neutral-200 rounded-xl p-4 flex items-center justify-between bg-neutral-50 shadow-sm">
                    <div className="flex items-center gap-4 overflow-hidden">
                        <div className="w-12 h-12 bg-red-100 text-red-600 rounded-lg flex items-center justify-center shrink-0">
                            <FileIcon className="w-6 h-6" />
                        </div>
                        <div className="overflow-hidden">
                            <p className="font-medium text-neutral-800 truncate">{file.name}</p>
                            <p className="text-xs text-neutral-500">
                                {(file.size / 1024 / 1024).toFixed(2)} MB 
                                {pdfDocument && ` • ${pdfDocument.numPages} páginas`}
                            </p>
                        </div>
                    </div>
                    {!processedPdfBlob && !isProcessing && (
                        <button 
                            onClick={removeFile}
                            className="p-2 text-neutral-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors border border-transparent hover:border-red-100"
                            aria-label="Remove file"
                        >
                            <X className="w-5 h-5" />
                        </button>
                    )}
                </div>
            )}

            {/* Error Message */}
            {error && (
                <motion.div initial={{opacity:0, y:-10}} animate={{opacity:1, y:0}} className="text-sm text-red-600 bg-red-50 border border-red-200 p-4 rounded-xl flex gap-3 items-start">
                    <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
                    <p>{error}</p>
                </motion.div>
            )}

            {/* Configuración & Vista Previa */}
            {file && !processedPdfBlob && pdfDocument && (
              <motion.div 
                initial={{ opacity: 0 }} 
                animate={{ opacity: 1 }}
                className="grid grid-cols-1 md:grid-cols-2 gap-8 pt-4 border-t border-neutral-100"
              >
                {/* Controles */}
                <div className="space-y-6 flex flex-col">
                  <div>
                    <label className="flex justify-between items-center mb-3">
                      <span className="font-medium text-neutral-800 flex items-center gap-2">
                          <SlidersHorizontal className="w-4 h-4 text-blue-600" />
                          Intensidad de Borrado
                      </span>
                      <span className="text-sm font-mono bg-neutral-100 text-neutral-700 px-2 py-0.5 rounded-md">{intensity}%</span>
                    </label>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      value={intensity}
                      onChange={(e) => setIntensity(parseInt(e.target.value))}
                      className="w-full accent-blue-600 h-2 bg-neutral-200 rounded-lg appearance-none cursor-pointer"
                    />
                    <p className="text-xs text-neutral-500 mt-3 leading-relaxed">
                      Desliza a la derecha hasta que la marca desaparezca. La aplicación reescribe el PDF como imagen eliminando tonos grises (White Point).
                    </p>
                  </div>

                  <div className="mt-auto pt-6">
                      <button
                        onClick={handleProcess}
                        disabled={isProcessing}
                        className="w-full bg-blue-600 text-white rounded-xl py-3.5 font-medium hover:bg-blue-700 active:bg-blue-800 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-lg shadow-blue-600/20"
                      >
                        {isProcessing ? (
                          <>
                            <Loader2 className="w-5 h-5 animate-spin" />
                            Generando PDF Nuevo ({progress}%)
                          </>
                        ) : (
                          "Limpiar PDF Completo"
                        )}
                      </button>
                  </div>
                </div>

                {/* Preview */}
                <div className="bg-neutral-50 rounded-xl p-3 border border-neutral-200">
                  <h4 className="text-xs font-semibold text-neutral-400 mb-2 uppercase tracking-wider text-center">Vista Previa Dinámica (Pág. 1)</h4>
                  {previewUrl ? (
                    <div className="aspect-[1/1.414] relative bg-white shadow-sm border border-neutral-200 rounded-md overflow-hidden" 
                         style={{backgroundImage: 'repeating-conic-gradient(#f0f0f0 0% 25%, transparent 0% 50%)', backgroundSize: '16px 16px', backgroundPosition: '0 0, 8px 8px'}}>
                      <img src={previewUrl} alt="Vista previa filtrada" className="w-full h-full object-contain" />
                    </div>
                  ) : (
                    <div className="aspect-[1/1.414] flex flex-col items-center justify-center text-neutral-400">
                       <Loader2 className="w-6 h-6 animate-spin mb-2" />
                       <span className="text-xs">Extrayendo...</span>
                    </div>
                  )}
                </div>

              </motion.div>
            )}

            {/* Resultado Final */}
            {processedPdfBlob && (
              <motion.div 
                initial={{ opacity: 0, scale: 0.98 }} 
                animate={{ opacity: 1, scale: 1 }}
                className="pt-4 border-t border-neutral-100"
              >
                <div className="bg-green-50 border border-green-200 rounded-xl p-8 text-center space-y-5">
                  <div className="w-16 h-16 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto shadow-sm">
                    <CheckCircle className="w-8 h-8" />
                  </div>
                  <div>
                    <h3 className="text-xl font-bold text-green-900 mb-1">¡PDF Reconstruido con Éxito!</h3>
                    <p className="text-sm text-green-700 max-w-sm mx-auto">
                        Se ha eliminado el filtro visual aplicado en {pdfDocument?.numPages} páginas. El texto y los fondos han sido purificados.
                    </p>
                  </div>
                  
                  <div className="flex flex-col sm:flex-row gap-3 justify-center pt-4">
                    <button
                        onClick={removeFile}
                        className="px-6 py-3 bg-white text-neutral-700 font-medium rounded-xl border border-neutral-300 hover:bg-neutral-50 transition-colors"
                    >
                        Procesar otro archivo
                    </button>
                    <button
                        onClick={downloadProcessed}
                        className="px-6 py-3 bg-green-600 text-white font-medium rounded-xl hover:bg-green-700 transition-colors flex items-center justify-center gap-2 shadow-lg shadow-green-600/20"
                    >
                        <Download className="w-5 h-5" />
                        Descargar PDF
                    </button>
                  </div>
                </div>
              </motion.div>
            )}

          </div>
        </div>
      </div>
    </div>
  );
}
