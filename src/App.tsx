import React, { useState, useRef, useEffect } from 'react';
import { UploadCloud, File as FileIcon, X, Download, Loader2, SlidersHorizontal, CheckCircle, AlertCircle, Eye, Maximize2 } from 'lucide-react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url';
import { PDFDocument } from 'pdf-lib';
import { cn } from './lib/utils';
import { motion, AnimatePresence } from 'motion/react';

// Request pdf.js worker local
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export default function App() {
  const [file, setFile] = useState<File | null>(null);
  const [pdfDocument, setPdfDocument] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [originalImageData, setOriginalImageData] = useState<ImageData | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isPreviewExpanded, setIsPreviewExpanded] = useState(false);
  
  const [intensity, setIntensity] = useState(40); // 0 to 100
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
    setIntensity(40);
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
      
      // Render page 1 at a higher scale (1.5) for a crisp, readable preview
      const { imageData } = await renderPageToImageData(pdf, 1, 1.5);
      setOriginalImageData(imageData);
    } catch (err: any) {
      console.error(err);
      setError(`Error al leer el PDF: ${err.message || "Archivo corrupto o protegido"}`);
      setFile(null);
    }
  };

  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      setIntensity(parseInt(e.target.value));
      // Invalidate the processed PDF so the user has to click "Process" again 
      if (processedPdfBlob) setProcessedPdfBlob(null);
  }

  // Update preview image dynamically when intensity changes
  useEffect(() => {
    if (!originalImageData) return;
    
    const whitePoint = 255 - (intensity * 1.55);
    const factor = 255 / whitePoint;
    
    const data = new Uint8ClampedArray(originalImageData.data);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = Math.min(255, data[i] * factor);
      data[i+1] = Math.min(255, data[i+1] * factor);
      data[i+2] = Math.min(255, data[i+2] * factor);
    }
    
    const filtered = new ImageData(data, originalImageData.width, originalImageData.height);
    
    const canvas = document.createElement('canvas');
    canvas.width = filtered.width;
    canvas.height = filtered.height;
    const ctx = canvas.getContext('2d');
    ctx?.putImageData(filtered, 0, 0);
    
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
        
        const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
        const img = await outPdf.embedJpg(dataUrl);
        
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
    <div className="min-h-screen bg-neutral-50 flex flex-col items-center p-4 md:p-8 font-sans text-neutral-900">
      
      {/* Header Logotipo / Titulo */}
      <div className="w-full max-w-6xl mb-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-neutral-900 tracking-tight">Limpiador Óptico PDF</h1>
            <p className="text-neutral-500">Ajusta la vista previa y remueve marcas de agua suavemente.</p>
          </div>
      </div>

      <div className="w-full max-w-6xl bg-white rounded-3xl shadow-xl border border-neutral-200 overflow-hidden">
        {/* Main Workspace Workspace */}
        <div className="p-6 md:p-8">
            
            {!file ? (
              // Empty State
              <div 
                className="w-full max-w-2xl mx-auto border-2 border-dashed border-neutral-300 rounded-2xl p-16 text-center hover:bg-neutral-50 hover:border-blue-400 transition-colors cursor-pointer group my-12"
                onDragOver={handleDragOver}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
              >
                <div className="w-20 h-20 bg-blue-50 text-blue-600 rounded-full flex items-center justify-center mx-auto mb-6 group-hover:scale-105 transition-transform duration-300 shadow-inner">
                  <UploadCloud className="w-10 h-10" />
                </div>
                <h3 className="text-2xl font-bold text-neutral-800 mb-2">Sube tu archivo PDF</h3>
                <p className="text-neutral-500 mb-8 max-w-sm mx-auto">Arrastra y suelta tu documento aquí para comenzar a limpiarlo visualmente.</p>
                <span className="bg-neutral-900 text-white px-8 py-3.5 rounded-xl font-medium shadow-md hover:bg-neutral-800 transition-colors">
                    Examinar archivos
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
                <div className="flex flex-col lg:flex-row gap-8">
                    {/* Controls Panel (Left side) */}
                    <div className="w-full lg:w-5/12 flex flex-col space-y-6">
                        
                        {/* File Info */}
                        <div className="border border-neutral-200 rounded-2xl p-4 flex items-center justify-between bg-neutral-50 shadow-sm">
                            <div className="flex items-center gap-4 overflow-hidden">
                                <div className="w-12 h-12 bg-blue-100 text-blue-600 rounded-xl flex items-center justify-center shrink-0">
                                    <FileIcon className="w-6 h-6" />
                                </div>
                                <div className="overflow-hidden">
                                    <p className="font-semibold text-neutral-800 truncate" title={file.name}>{file.name}</p>
                                    <p className="text-xs text-neutral-500 font-medium">
                                        {(file.size / 1024 / 1024).toFixed(2)} MB 
                                        {pdfDocument && ` • ${pdfDocument.numPages} págs.`}
                                    </p>
                                </div>
                            </div>
                            <button 
                                onClick={removeFile}
                                disabled={isProcessing}
                                className="p-2 text-neutral-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
                                aria-label="Cambiar archivo"
                                title="Cambiar archivo"
                            >
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        {/* Error Alert */}
                        {error && (
                            <motion.div initial={{opacity:0, height:0}} animate={{opacity:1, height:'auto'}} className="overflow-hidden">
                                <div className="text-sm text-red-700 bg-red-50 border border-red-200 p-4 rounded-xl flex gap-3 items-start">
                                    <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
                                    <p>{error}</p>
                                </div>
                            </motion.div>
                        )}

                        {/* Slider Configuration */}
                        {pdfDocument && (
                            <div className="bg-white border text-left border-neutral-200 rounded-2xl p-6 shadow-sm flex-1">
                                <label className="flex justify-between items-center mb-4">
                                  <span className="font-semibold text-neutral-800 flex items-center gap-2 text-lg">
                                      <SlidersHorizontal className="w-5 h-5 text-blue-600" />
                                      Intensidad de Borrado
                                  </span>
                                  <span className="text-sm font-bold bg-blue-50 text-blue-700 px-3 py-1 rounded-lg border border-blue-100">
                                      {intensity}%
                                  </span>
                                </label>
                                <input
                                  type="range"
                                  min="0"
                                  max="100"
                                  value={intensity}
                                  onChange={handleSliderChange}
                                  className="w-full accent-blue-600 h-2.5 bg-neutral-100 rounded-lg appearance-none cursor-pointer mb-5"
                                />
                                <div className="text-sm text-neutral-500 leading-relaxed space-y-2">
                                  <p>1. Ajusta el borrador fijándote en la <strong>Vista Previa grande</strong> a tu derecha. Los cambios son en tiempo real.</p>
                                  <p>2. Cuando la marca de agua sea imperceptible en la previsualización, haz clic en procesar.</p>
                                </div>

                                {/* Process / Actions block */}
                                <div className="mt-8">
                                    {!processedPdfBlob ? (
                                        <button
                                            onClick={handleProcess}
                                            disabled={isProcessing}
                                            className="w-full bg-neutral-900 text-white rounded-xl py-4 font-semibold hover:bg-neutral-800 active:bg-neutral-950 transition-all disabled:opacity-50 flex items-center justify-center gap-3 shadow-lg hover:shadow-xl"
                                        >
                                            {isProcessing ? (
                                                <>
                                                <Loader2 className="w-5 h-5 animate-spin" />
                                                Aplicando a las {pdfDocument.numPages} págs ({progress}%)
                                                </>
                                            ) : (
                                                "Limpiar Documento Completo"
                                            )}
                                        </button>
                                    ) : (
                                        <motion.div initial={{opacity: 0, y: 10}} animate={{opacity: 1, y: 0}}>
                                            <div className="bg-green-50 border border-green-200 rounded-xl p-5 text-center">
                                                <div className="flex justify-center mb-3">
                                                    <div className="bg-green-100 text-green-600 p-2 rounded-full">
                                                        <CheckCircle className="w-6 h-6" />
                                                    </div>
                                                </div>
                                                <h4 className="text-green-800 font-bold mb-1">¡Documento Listo!</h4>
                                                <p className="text-green-700 text-sm mb-5">
                                                    Si el resultado es bueno, descárgalo. Si no, mueve el deslizador para recalcular.
                                                </p>
                                                <button 
                                                    onClick={downloadProcessed}
                                                    className="w-full bg-green-600 text-white rounded-xl py-3.5 font-bold hover:bg-green-700 transition-colors flex items-center justify-center gap-2 shadow-lg shadow-green-600/20"
                                                >
                                                    <Download className="w-5 h-5" />
                                                    Descargar Nuevo PDF
                                                </button>
                                            </div>
                                        </motion.div>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Preview Panel (Right Side) */}
                    <div className="w-full lg:w-7/12 flex flex-col">
                        <div className="bg-neutral-900 rounded-2xl p-4 flex flex-col flex-1 shadow-inner relative border border-neutral-800 min-h-[500px]">
                            <div className="flex justify-between items-center mb-4 px-2">
                              <h3 className="font-semibold text-neutral-100 flex items-center gap-2">
                                 <Eye className="w-4 h-4 text-blue-400" /> Vista Previa Dinámica (Pág. 1)
                              </h3>
                              <button 
                                onClick={() => setIsPreviewExpanded(true)} 
                                disabled={!previewUrl}
                                className="p-2 hover:bg-white/10 rounded-lg text-neutral-300 transition-colors disabled:opacity-50" 
                                title="Expandir a pantalla completa"
                              >
                                 <Maximize2 className="w-5 h-5" />
                              </button>
                            </div>

                            <div className="flex-1 bg-black/40 rounded-xl overflow-hidden flex items-center justify-center p-4 relative" style={{backgroundImage: 'repeating-conic-gradient(rgba(255,255,255,0.03) 0% 25%, transparent 0% 50%)', backgroundSize: '20px 20px'}}>
                              {previewUrl ? (
                                 <img 
                                    src={previewUrl} 
                                    alt="Vista previa aplicando el filtro" 
                                    className="max-w-full max-h-[600px] object-contain shadow-2xl bg-white transition-opacity duration-200" 
                                 />
                              ) : (
                                <div className="flex flex-col items-center justify-center text-neutral-500">
                                   {pdfDocument ? <Loader2 className="w-8 h-8 animate-spin mb-3" /> : null}
                                   <span>{pdfDocument ? "Generando visualización..." : "Esperando archivo"}</span>
                                </div>
                              )}
                            </div>
                        </div>
                    </div>

                </div>
            )}
        </div>
      </div>

      {/* Expanded Preview Modal */}
      <AnimatePresence>
        {isPreviewExpanded && previewUrl && (
           <motion.div 
             initial={{opacity: 0}} 
             animate={{opacity: 1}} 
             exit={{opacity: 0}} 
             className="fixed inset-0 z-50 bg-black/95 flex flex-col p-4 md:p-8 backdrop-blur-sm"
           >
              <div className="flex justify-between items-center mb-6 max-w-5xl mx-auto w-full">
                  <span className="text-white/80 font-medium tracking-wide flex items-center gap-2"><Eye className="w-5 h-5"/> Vista Previa Ampliada</span>
                  <button 
                      onClick={() => setIsPreviewExpanded(false)} 
                      className="p-3 bg-white/10 hover:bg-white/20 text-white rounded-full backdrop-blur-md transition-colors"
                  >
                      <X className="w-6 h-6" />
                  </button>
              </div>
              <div className="flex-1 overflow-auto flex items-start justify-center pb-8 border border-white/10 rounded-2xl bg-neutral-900/50 p-4 md:p-10">
                  {/* Let the image scroll if it's too tall by keeping h-auto */}
                  <img 
                      src={previewUrl} 
                      className="w-full max-w-4xl h-auto object-contain bg-white shadow-[0_0_50px_rgba(0,0,0,0.5)]" 
                      alt="Full screen preview"
                  />
              </div>
           </motion.div>
        )}
      </AnimatePresence>

    </div>
  );
}
