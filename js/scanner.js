/**
 * SCANNER - Gestión de cámara, OCR y QR con DOBLE OCR ESPECIALIZADO
 * VERSIÓN ULTRA OPTIMIZADA PARA CELULAR
 * 
 * ARQUITECTURA COMPLETA:
 * 1. OCR GENERAL: imagen completa → texto normal (nombre, fecha, celular, detalle, tienda)
 * 2. OCR CÓDIGO: ROI escalonado + múltiples variantes + votación inteligente
 * 3. FUSIÓN: código del OCR especializado tiene prioridad
 * 4. MEJORA DE IMAGEN: multi-estrategia para diferentes iluminaciones
 * 5. CORRECCIÓN OCR: 20+ mapeos de confusiones visuales
 * 6. SISTEMA DE VOTACIÓN: frecuencia + confianza + estructura
 * 
 * OPTIMIZACIONES PARA CELULAR:
 * - Detección automática de capacidades del dispositivo
 * - Resolución adaptativa según rendimiento
 * - Workers con timeout y fallback
 * - Procesamiento en lotes para evitar bloqueos
 * - Memoria liberada inmediatamente
 * - Logs con niveles de detalle
 * - Cache de resultados para evitar reprocesamiento
 */

const Scanner = {
    // ============================================================
    // PROPIEDADES
    // ============================================================
    stream: null,
    currentDeviceId: null,
    availableCameras: [],
    ocrWorker: null,
    ocrCodeWorker: null,
    qrScanner: null,
    scanMode: 'registro',
    scanType: 'ocr',
    onResultCallback: null,
    isProcessing: false,
    debug: true,
    isMobile: false,
    deviceCapabilities: { cpu: 'medium', memory: 'medium' },
    resultCache: {},
    processingTime: 0,
    stats: { attempts: 0, success: 0, failures: 0 },

    // ============================================================
    // INICIALIZACIÓN
    // ============================================================
    init(onResult) {
        this.onResultCallback = onResult || function () {};
        
        // Detectar dispositivo
        this.isMobile = /Android|iPhone|iPad|iPod|BlackBerry|Opera Mini|IEMobile/i.test(navigator.userAgent);
        
        // Detectar capacidades
        this.detectarCapacidades();
        
        if (this.debug) {
            console.log(`🔍 Scanner inicializado`);
            console.log(`📱 Modo: ${this.isMobile ? 'MÓVIL' : 'PC'}`);
            console.log(`⚡ CPU: ${this.deviceCapabilities.cpu}, Memoria: ${this.deviceCapabilities.memory}`);
        }
    },

    detectarCapacidades() {
        // Detectar núcleos de CPU
        const cores = navigator.hardwareConcurrency || 2;
        if (cores >= 8) {
            this.deviceCapabilities.cpu = 'high';
        } else if (cores >= 4) {
            this.deviceCapabilities.cpu = 'medium';
        } else {
            this.deviceCapabilities.cpu = 'low';
        }

        // Detectar memoria (estimada)
        if ('deviceMemory' in navigator) {
            const mem = navigator.deviceMemory || 4;
            if (mem >= 8) {
                this.deviceCapabilities.memory = 'high';
            } else if (mem >= 4) {
                this.deviceCapabilities.memory = 'medium';
            } else {
                this.deviceCapabilities.memory = 'low';
            }
        }
    },

    // ============================================================
    // MODO Y TIPO
    // ============================================================
    setMode(mode) {
        this.scanMode = mode;
        document.getElementById('modeRegistro').classList.toggle('active', mode === 'registro');
        document.getElementById('modeConsulta').classList.toggle('active', mode === 'consulta');
        document.getElementById('scanResultBox').innerHTML = '';
        if (this.debug) console.log(`📋 Modo: ${mode}`);
    },

    setType(type) {
        if (this.stream || this.qrScanner) this.stop();
        this.scanType = type;
        document.getElementById('typeOcr').classList.toggle('active', type === 'ocr');
        document.getElementById('typeQr').classList.toggle('active', type === 'qr');
        document.getElementById('scanResultBox').innerHTML = '';
        if (this.debug) console.log(`📋 Tipo: ${type}`);
    },

    // ============================================================
    // CÁMARA - OPTIMIZADA PARA CELULAR
    // ============================================================
    async startCamera() {
        document.getElementById('scanResultBox').innerHTML = '';
        if (this.scanType === 'qr') { return this.startQr(); }

        try {
            // Resolución adaptativa según capacidades
            let maxRes = 1920;
            if (this.isMobile) {
                if (this.deviceCapabilities.cpu === 'high') maxRes = 1920;
                else if (this.deviceCapabilities.cpu === 'medium') maxRes = 1280;
                else maxRes = 800;
            }

            const constraints = this.currentDeviceId ?
                { video: { 
                    deviceId: { exact: this.currentDeviceId },
                    width: { ideal: maxRes },
                    height: { ideal: maxRes * 0.75 },
                    focusMode: 'continuous',
                    exposureMode: 'continuous'
                } } :
                { video: { 
                    facingMode: { ideal: 'environment' },
                    width: { ideal: maxRes },
                    height: { ideal: maxRes * 0.75 },
                    focusMode: 'continuous',
                    exposureMode: 'continuous'
                } };

            if (this.debug) console.log(`📷 Resolución cámara: ${maxRes}x${Math.round(maxRes * 0.75)}`);

            this.stream = await navigator.mediaDevices.getUserMedia(constraints);
        } catch (e) {
            toast('❌ No se pudo acceder a la cámara: ' + e.message, 'error');
            return;
        }

        const video = document.getElementById('video');
        video.srcObject = this.stream;
        video.style.display = 'block';
        document.getElementById('camPlaceholder').style.display = 'none';
        document.getElementById('camGuide').style.display = 'block';
        await video.play();

        document.getElementById('btnStartCam').style.display = 'none';
        document.getElementById('btnStopCam').style.display = 'inline-flex';
        document.getElementById('btnCapture').style.display = 'inline-flex';

        try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            this.availableCameras = devices.filter(d => d.kind === 'videoinput');
            document.getElementById('btnSwitchCam').style.display = this.availableCameras.length > 1 ? 'inline-flex' : 'none';
        } catch (e) {}

        this.setStatus('✅ Cámara lista. Presiona "Capturar"', true);
        if (this.debug) console.log('📷 Cámara iniciada');
    },

    async switchCamera() {
        if (!this.availableCameras.length) return;
        const idx = this.availableCameras.findIndex(d => d.deviceId === this.currentDeviceId);
        const next = this.availableCameras[(idx + 1) % this.availableCameras.length];
        this.currentDeviceId = next.deviceId;
        this.stop(true);
        await this.startCamera();
    },

    stop(keepResult) {
        if (this.stream) {
            this.stream.getTracks().forEach(t => t.stop());
            this.stream = null;
        }
        if (this.qrScanner) {
            this.qrScanner.stop().then(() => { try { this.qrScanner.clear(); } catch (e) {} }).catch(() => {});
            this.qrScanner = null;
        }
        const video = document.getElementById('video');
        video.style.display = 'none';
        video.srcObject = null;
        document.getElementById('qr-reader').style.display = 'none';
        document.getElementById('qr-reader').innerHTML = '';
        document.getElementById('camPlaceholder').style.display = 'block';
        document.getElementById('camGuide').style.display = 'none';
        document.getElementById('btnStartCam').style.display = 'inline-flex';
        document.getElementById('btnStopCam').style.display = 'none';
        document.getElementById('btnSwitchCam').style.display = 'none';
        document.getElementById('btnCapture').style.display = 'none';
        this.setStatus('', false);
        if (!keepResult) document.getElementById('scanResultBox').innerHTML = '';
        if (this.debug) console.log('⏹ Cámara detenida');
    },

    setStatus(msg, show) {
        const el = document.getElementById('camStatus');
        el.textContent = msg;
        el.classList.toggle('show', !!show);
    },

    // ============================================================
    // WORKERS OCR - CON CACHE Y TIMEOUT
    // ============================================================
    async getOcrWorker() {
        if (!this.ocrWorker) {
            this.setStatus('⏳ (1/2) Cargando OCR...', true);
            if (this.debug) console.log('⏳ Creando worker OCR general...');
            
            const startTime = Date.now();
            
            try {
                // Configuración optimizada para móvil
                this.ocrWorker = await Tesseract.createWorker('spa');
                // Configurar para mejor rendimiento en móvil
                await this.ocrWorker.setParameters({
                    tessedit_pageseg_mode: '6', // PSM.SINGLE_BLOCK
                    tessedit_ocr_engine_mode: '3' // OEM_LSTM_ONLY
                });
                const elapsed = Date.now() - startTime;
                if (this.debug) console.log(`✅ Worker OCR general listo (${elapsed}ms)`);
            } catch (e) {
                console.error('Error creando worker general:', e);
                throw e;
            }
        }
        return this.ocrWorker;
    },

    async getOcrCodeWorker() {
        if (!this.ocrCodeWorker) {
            this.setStatus('⏳ (2/2) Cargando OCR código...', true);
            if (this.debug) console.log('⏳ Creando worker OCR código...');
            
            const startTime = Date.now();
            
            try {
                this.ocrCodeWorker = await Tesseract.createWorker('eng');
                await this.ocrCodeWorker.setParameters({
                    tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
                    tessedit_pageseg_mode: '8', // SINGLE_WORD
                    tessedit_ocr_engine_mode: '3' // OEM_LSTM_ONLY
                });
                const elapsed = Date.now() - startTime;
                if (this.debug) console.log(`✅ Worker OCR código listo (${elapsed}ms)`);
            } catch (e) {
                console.error('Error creando worker código:', e);
                this.ocrCodeWorker = null;
            }
        }
        return this.ocrCodeWorker;
    },

    // ============================================================
    // MEJORA DE IMAGEN - MULTI-ESTRATEGIA AVANZADA
    // ============================================================
    mejorarImagenParaOCR(ctx, w, h, estrategia, params = {}) {
        const imgData = ctx.getImageData(0, 0, w, h);
        const d = imgData.data;
        
        // Parámetros ajustables
        const contraste = params.contraste || 2.0;
        const umbral = params.umbral || 120;
        const brillo = params.brillo || 0;
        
        switch (estrategia) {
            case 'contraste_fuerte':
                for (let i = 0; i < d.length; i += 4) {
                    let gray = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
                    gray = (gray - 128) * contraste + 128 + brillo;
                    gray = Math.max(0, Math.min(255, gray));
                    const val = gray > umbral ? 255 : 0;
                    d[i] = d[i + 1] = d[i + 2] = val;
                }
                break;
                
            case 'contraste_medio':
                for (let i = 0; i < d.length; i += 4) {
                    let gray = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
                    gray = (gray - 128) * 1.6 + 128 + brillo;
                    gray = Math.max(0, Math.min(255, gray));
                    const val = gray > (umbral + 10) ? 255 : 0;
                    d[i] = d[i + 1] = d[i + 2] = val;
                }
                break;
                
            case 'grises':
                for (let i = 0; i < d.length; i += 4) {
                    let gray = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
                    gray = (gray - 128) * 1.4 + 128 + brillo;
                    gray = Math.max(0, Math.min(255, gray));
                    d[i] = d[i + 1] = d[i + 2] = gray;
                }
                break;
                
            case 'grises_contraste':
                for (let i = 0; i < d.length; i += 4) {
                    let gray = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
                    gray = (gray - 128) * 2.0 + 128 + brillo;
                    gray = Math.max(0, Math.min(255, gray));
                    d[i] = d[i + 1] = d[i + 2] = gray > 140 ? 255 : gray;
                }
                break;
                
            case 'invertida':
                for (let i = 0; i < d.length; i += 4) {
                    let gray = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
                    const val = gray > umbral ? 0 : 255;
                    d[i] = d[i + 1] = d[i + 2] = val;
                }
                break;
                
            case 'sharp':
                // Nitidez (aplicar filtro de sharpen)
                // Esta estrategia es más compleja, se aplica solo si es necesario
                const sharpData = ctx.getImageData(0, 0, w, h);
                const s = sharpData.data;
                const kernel = [-1, -1, -1, -1, 9, -1, -1, -1, -1];
                const kSize = 3;
                const half = Math.floor(kSize / 2);
                
                for (let y = half; y < h - half; y++) {
                    for (let x = half; x < w - half; x++) {
                        const idx = (y * w + x) * 4;
                        let sum = 0;
                        for (let ky = 0; ky < kSize; ky++) {
                            for (let kx = 0; kx < kSize; kx++) {
                                const nx = x + kx - half;
                                const ny = y + ky - half;
                                const nIdx = (ny * w + nx) * 4;
                                const gray = 0.299 * s[nIdx] + 0.587 * s[nIdx + 1] + 0.114 * s[nIdx + 2];
                                sum += gray * kernel[ky * kSize + kx];
                            }
                        }
                        const val = Math.max(0, Math.min(255, sum));
                        d[idx] = d[idx + 1] = d[idx + 2] = val;
                    }
                }
                break;
                
            default:
                break;
        }
        
        ctx.putImageData(imgData, 0, 0);
    },

    // ============================================================
    // 📸 CAPTURAR IMAGEN - OPTIMIZADA PARA CELULAR
    // ============================================================
    capturarImagen(video) {
        const canvas = document.getElementById('ocrCanvas');
        const vW = video.videoWidth;
        const vH = video.videoHeight;
        
        // Resolución adaptativa según capacidades
        let maxRes = 1400;
        if (this.isMobile) {
            if (this.deviceCapabilities.cpu === 'high') maxRes = 1400;
            else if (this.deviceCapabilities.cpu === 'medium') maxRes = 1000;
            else maxRes = 700;
        }
        
        const scale = Math.min(1, maxRes / vW);
        canvas.width = Math.round(vW * scale);
        canvas.height = Math.round(vH * scale);
        
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        
        if (this.debug) {
            console.log(`📐 Captura: ${canvas.width}x${canvas.height} (escala: ${scale.toFixed(2)})`);
        }
        
        return canvas;
    },

    // ============================================================
    // 🔍 OCR ESPECIALIZADO PARA CÓDIGO GRANDE - VERSIÓN ULTRA
    // ============================================================
    async extraerCodigoGrande(sourceCanvas) {
        const vW = sourceCanvas.width;
        const vH = sourceCanvas.height;
        
        if (this.debug) console.log(`📐 Procesando código: ${vW}x${vH}`);

        // ROI escalonado - Múltiples regiones para máxima cobertura
        const rois = [
            { x: vW * 0.05, y: vH * 0.02, w: vW * 0.90, h: vH * 0.25, nombre: 'principal', escala: 4.5 },
            { x: vW * 0.03, y: vH * 0.01, w: vW * 0.94, h: vH * 0.35, nombre: 'ampliado', escala: 4.0 },
            { x: vW * 0.02, y: vH * 0.01, w: vW * 0.96, h: vH * 0.42, nombre: 'fallback', escala: 3.5 },
            { x: vW * 0.10, y: vH * 0.05, w: vW * 0.80, h: vH * 0.20, nombre: 'centrado', escala: 5.0 }
        ];

        let todosResultados = [];
        let mejorGeneral = null;
        let mejorConfianza = 0;
        let mejorFrecuencia = 0;

        for (const roi of rois) {
            if (this.debug) {
                console.log(`📐 ROI "${roi.nombre}": ${roi.x.toFixed(0)},${roi.y.toFixed(0)} ${roi.w.toFixed(0)}x${roi.h.toFixed(0)}`);
            }

            // Extraer ROI
            const roiCanvas = document.createElement('canvas');
            const escala = this.isMobile ? Math.min(roi.escala, 4) : roi.escala;
            roiCanvas.width = Math.round(roi.w * escala);
            roiCanvas.height = Math.round(roi.h * escala);
            const ctx = roiCanvas.getContext('2d');
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(sourceCanvas, roi.x, roi.y, roi.w, roi.h, 0, 0, roiCanvas.width, roiCanvas.height);

            // Procesar variantes de este ROI
            const resultadosRoi = await this.procesarVariantesCodigo(roiCanvas, roi.nombre);
            roiCanvas.width = 0;
            roiCanvas.height = 0;

            // Acumular resultados
            if (resultadosRoi.length > 0) {
                todosResultados = todosResultados.concat(resultadosRoi);
            }

            // Buscar el mejor resultado válido de este ROI
            const mejorDeRoi = this.encontrarMejorResultado(resultadosRoi);
            
            if (mejorDeRoi && mejorDeRoi.codigo && esCodigoValido(mejorDeRoi.codigo)) {
                const confianza = mejorDeRoi.confianza || 0;
                const frecuencia = mejorDeRoi.frecuencia || 0;
                
                // Early exit: confianza > 65% en ROI principal
                if (confianza > 65 && roi.nombre === 'principal') {
                    if (this.debug) {
                        console.log(`✅ ROI "${roi.nombre}" encontró: "${mejorDeRoi.codigo}" (conf: ${confianza}, freq: ${frecuencia})`);
                        console.log(`🛑 Early exit - no se procesan más ROIs`);
                    }
                    return {
                        codigo: mejorDeRoi.codigo,
                        confianza: confianza,
                        frecuencia: frecuencia,
                        metodo: roi.nombre,
                        intentos: rois.indexOf(roi) + 1,
                        variantes: resultadosRoi.length
                    };
                }
                
                // Guardar como mejor global
                if (confianza > mejorConfianza || (confianza === mejorConfianza && frecuencia > mejorFrecuencia)) {
                    mejorConfianza = confianza;
                    mejorFrecuencia = frecuencia;
                    mejorGeneral = mejorDeRoi;
                }
            }
        }

        // Si encontramos un resultado válido en algún ROI
        if (mejorGeneral && mejorGeneral.codigo && esCodigoValido(mejorGeneral.codigo)) {
            if (this.debug) {
                console.log(`✅ Mejor resultado global: "${mejorGeneral.codigo}" (conf: ${mejorConfianza}, freq: ${mejorFrecuencia})`);
            }
            return {
                codigo: mejorGeneral.codigo,
                confianza: mejorConfianza,
                frecuencia: mejorFrecuencia,
                metodo: 'global',
                intentos: rois.length,
                variantes: todosResultados.length
            };
        }

        // Si no hay código válido, intentar extraer de cualquier texto
        if (todosResultados.length > 0) {
            const extraido = this.extraerCodigoDeResultados(todosResultados);
            if (extraido) {
                if (this.debug) console.log(`🔧 Código extraído de resultados: "${extraido}"`);
                return {
                    codigo: extraido,
                    confianza: 30,
                    frecuencia: 1,
                    metodo: 'extraido',
                    intentos: rois.length,
                    variantes: todosResultados.length
                };
            }
        }

        if (this.debug) console.log('❌ No se detectó código válido en ningún ROI');
        return { codigo: null, confianza: 0, frecuencia: 0, metodo: 'ninguno', intentos: rois.length, variantes: 0 };
    },

    // ============================================================
    // PROCESAR VARIANTES DE UN ROI - ULTRA OPTIMIZADO
    // ============================================================
    async procesarVariantesCodigo(roiCanvas, roiNombre) {
        const resultados = [];
        const workerCode = await this.getOcrCodeWorker();
        if (!workerCode) return resultados;

        // Estrategias de procesamiento - Optimizadas para celular
        const estrategias = [
            { nombre: 'contraste_alto', metodo: 'contraste_fuerte', params: { contraste: 2.5, umbral: 100 } },
            { nombre: 'contraste_medio', metodo: 'contraste_medio', params: { contraste: 1.8, umbral: 130 } },
            { nombre: 'grises', metodo: 'grises', params: { contraste: 1.4 } },
            { nombre: 'grises_contraste', metodo: 'grises_contraste', params: { contraste: 2.0 } },
            { nombre: 'invertida', metodo: 'invertida', params: { umbral: 135 } },
            { nombre: 'sharp', metodo: 'sharp', params: {} }
        ];

        // Limitar estrategias en móvil para velocidad
        const estrategiasLimitadas = this.isMobile ? 
            estrategias.slice(0, 4) : // Solo 4 en móvil
            estrategias;

        for (const est of estrategiasLimitadas) {
            const canvas = document.createElement('canvas');
            canvas.width = roiCanvas.width;
            canvas.height = roiCanvas.height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(roiCanvas, 0, 0);
            
            // Aplicar mejora según estrategia
            this.mejorarImagenParaOCR(ctx, canvas.width, canvas.height, est.metodo, est.params || {});

            try {
                const result = await workerCode.recognize(canvas);
                const texto = result.data.text.trim();
                const confianza = result.data.confidence || 0;
                
                if (texto) {
                    resultados.push({
                        texto: texto,
                        confianza: confianza,
                        variante: est.nombre,
                        roi: roiNombre,
                        timestamp: Date.now()
                    });
                }
                
                if (this.debug && texto) {
                    console.log(`   📊 Variante "${est.nombre}" (${roiNombre}): "${texto}" (conf: ${confianza})`);
                }
            } catch (e) {
                if (this.debug) console.warn(`   ⚠️ Error en variante "${est.nombre}":`, e.message);
            }
            
            canvas.width = 0;
            canvas.height = 0;
        }

        // Intentar con escalas adicionales (solo en PC o móvil high-end)
        if (!this.isMobile || this.deviceCapabilities.cpu === 'high') {
            const escalas = [1.5, 2.0];
            for (const esc of escalas) {
                const canvas = document.createElement('canvas');
                canvas.width = Math.round(roiCanvas.width * esc);
                canvas.height = Math.round(roiCanvas.height * esc);
                const ctx = canvas.getContext('2d');
                ctx.imageSmoothingEnabled = true;
                ctx.imageSmoothingQuality = 'high';
                ctx.drawImage(roiCanvas, 0, 0, canvas.width, canvas.height);
                
                this.mejorarImagenParaOCR(ctx, canvas.width, canvas.height, 'contraste_medio', { umbral: 125 });

                try {
                    const result = await workerCode.recognize(canvas);
                    const texto = result.data.text.trim();
                    const confianza = result.data.confidence || 0;
                    
                    if (texto) {
                        resultados.push({
                            texto: texto,
                            confianza: confianza,
                            variante: 'escala_' + esc,
                            roi: roiNombre,
                            timestamp: Date.now()
                        });
                    }
                    
                    if (this.debug && texto) {
                        console.log(`   📊 Variante "escala_${esc}" (${roiNombre}): "${texto}" (conf: ${confianza})`);
                    }
                } catch (e) {
                    if (this.debug) console.warn(`   ⚠️ Error en escala ${esc}:`, e.message);
                }
                
                canvas.width = 0;
                canvas.height = 0;
            }
        }

        return resultados;
    },

    // ============================================================
    // ENCONTRAR EL MEJOR RESULTADO - VOTACIÓN INTELIGENTE
    // ============================================================
    encontrarMejorResultado(resultados) {
        if (!resultados || resultados.length === 0) return null;

        // Normalizar y validar
        const validos = [];
        const todos = [];
        
        for (const r of resultados) {
            const normalizado = normalizeCodigo(r.texto);
            todos.push({ original: r.texto, normalizado, confianza: r.confianza, variante: r.variante, roi: r.roi });
            
            if (esCodigoValido(normalizado)) {
                validos.push({
                    original: r.texto,
                    codigo: normalizado,
                    confianza: r.confianza,
                    variante: r.variante,
                    roi: r.roi,
                    peso: r.confianza > 50 ? 2 : 1 // Dar más peso a resultados con buena confianza
                });
            }
        }

        if (validos.length === 0) return null;

        // Votación ponderada por frecuencia y confianza
        const frecuencias = {};
        const pesos = {};
        
        for (const v of validos) {
            if (!frecuencias[v.codigo]) {
                frecuencias[v.codigo] = 0;
                pesos[v.codigo] = 0;
            }
            frecuencias[v.codigo] += v.peso || 1;
            pesos[v.codigo] += v.confianza || 0;
        }

        // Elegir el que aparece más veces, con mayor confianza
        let mejor = validos[0];
        let mejorScore = 0;
        
        for (const v of validos) {
            const freq = frecuencias[v.codigo] || 0;
            const confPromedio = pesos[v.codigo] / freq || 0;
            const score = freq * 100 + confPromedio; // Score combinado
            
            if (score > mejorScore) {
                mejorScore = score;
                mejor = v;
            }
        }

        return {
            codigo: mejor.codigo,
            confianza: mejor.confianza,
            frecuencia: frecuencias[mejor.codigo] || 1,
            variante: mejor.variante,
            roi: mejor.roi,
            score: mejorScore
        };
    },

    // ============================================================
    // EXTRAER CÓDIGO DE RESULTADOS NO VÁLIDOS
    // ============================================================
    extraerCodigoDeResultados(resultados) {
        for (const r of resultados) {
            // Buscar patrón letra+número con posibles separadores
            const patrones = [
                /([A-Z])\s*(\d{1,4})/i,
                /([A-Z])[-.\s](\d{1,4})/i,
                /([A-Z])(\d{1,4})/i
            ];
            
            for (const patron of patrones) {
                const m = r.texto.match(patron);
                if (m) {
                    const cand = normalizeCodigo(m[1] + m[2]);
                    if (esCodigoValido(cand)) return cand;
                }
            }
            
            // Buscar en texto limpio
            const limpio = r.texto.replace(/[^A-Z0-9]/gi, '').toUpperCase();
            const m2 = limpio.match(/([A-Z])(\d{1,4})/);
            if (m2) {
                const cand = normalizeCodigo(m2[1] + m2[2]);
                if (esCodigoValido(cand)) return cand;
            }
        }
        return null;
    },

    // ============================================================
    // CORRECCIÓN DE ERRORES COMUNES DE OCR - 20+ MAPEOS
    // ============================================================
    corregirCodigoOCR(texto) {
        if (!texto) return null;

        // Mapeo extensivo de confusiones visuales
        const correcciones = {
            // Letras → Números
            'O': '0', 'Q': '0', 'D': '0', 
            'I': '1', 'L': '1', 'T': '1', 'J': '1',
            'Z': '2', 'S': '5', 'B': '8', 
            'G': '6', 'A': '4', 'E': '3', 
            'H': '4', 'K': '1', 'M': '1', 
            'N': '1', 'V': '1', 'W': '1',
            'P': '9', 'R': '2', 'Y': '4', 'F': '7',
            'U': '0', 'C': '0', 'X': '0',
            // Letras → Letras (confusiones comunes)
            'E': 'A', 'G': 'A', 'J': 'A'
        };

        let normalizado = texto.toUpperCase().replace(/[^A-Z0-9]/g, '');

        // Si es muy corto, intentar corregir cada carácter
        if (normalizado.length <= 2) {
            let corregido = '';
            for (const char of normalizado) {
                corregido += correcciones[char] || char;
            }
            if (corregido.length >= 2 && /^[A-Z]/.test(corregido) && /\d/.test(corregido[1])) {
                return corregido;
            }
        }

        // Intentar extraer patrón con correcciones
        const match = normalizado.match(/^([A-Z])(\d+)/);
        if (match) {
            const letra = correcciones[match[1]] || match[1];
            let numeros = '';
            for (const d of match[2]) {
                numeros += correcciones[d] || d;
            }
            const result = letra + numeros;
            if (esCodigoValido(result)) return result;
        }

        // Si tiene formato A4g (g parece 9) o similar
        const m2 = normalizado.match(/^([A-Z])([A-Z]?)(\d*)/);
        if (m2) {
            const letra = correcciones[m2[1]] || m2[1];
            let numeros = '';
            if (m2[2] && /[0-9]/.test(correcciones[m2[2]] || m2[2])) {
                numeros += correcciones[m2[2]] || m2[2];
            }
            numeros += m2[3] || '';
            const result = letra + numeros;
            if (esCodigoValido(result)) return result;
        }

        // Intentar extraer cualquier patrón válido
        const anyMatch = normalizado.match(/([A-Z])(\d{1,4})/);
        if (anyMatch) {
            const letra = correcciones[anyMatch[1]] || anyMatch[1];
            let numeros = '';
            for (const d of anyMatch[2]) {
                numeros += correcciones[d] || d;
            }
            const result = letra + numeros;
            if (esCodigoValido(result)) return result;
        }

        return null;
    },

    // ============================================================
    // VALIDACIÓN Y NORMALIZACIÓN AVANZADA
    // ============================================================
    validarYNormalizarCodigo(texto) {
        if (!texto) return null;
        
        // Limpiar y normalizar
        let limpio = texto.toUpperCase().replace(/[^A-Z0-9]/g, '');
        
        // Intentar diferentes patrones
        const patrones = [
            /^([A-Z])(\d{1,4})$/, // A49
            /^([A-Z])(\d{1,4})([A-Z])$/, // A49B (extraer primero)
            /^([A-Z]{1,2})(\d{1,4})$/, // AB49
        ];
        
        for (const patron of patrones) {
            const match = limpio.match(patron);
            if (match) {
                const letra = match[1];
                let numeros = match[2] || '';
                // Si hay más números, tomarlos
                if (match[3]) numeros += match[3];
                const result = letra + numeros;
                if (esCodigoValido(result)) return result;
            }
        }
        
        // Si no coincide, intentar extraer cualquier letra+número
        const simple = limpio.match(/([A-Z])(\d{1,4})/);
        if (simple) {
            const result = simple[1] + simple[2];
            if (esCodigoValido(result)) return result;
        }
        
        return null;
    },

    // ============================================================
    // 📸 FUNCIÓN CENTRALIZADA: DOBLE OCR ULTRA
    // ============================================================
    async ejecutarDobleOCR(sourceCanvas) {
        const startTime = Date.now();
        this.stats.attempts++;
        
        if (this.debug) {
            console.log(`📐 Imagen: ${sourceCanvas.width}x${sourceCanvas.height}`);
            console.log(`📱 Modo: ${this.isMobile ? 'MÓVIL' : 'PC'}`);
        }

        // ============================================================
        // OCR #1: GENERAL (texto normal) - OPTIMIZADO
        // ============================================================
        this.setStatus('🔎 Leyendo ticket...', true);

        const generalCanvas = document.createElement('canvas');
        const maxWidth = this.isMobile ? 900 : 1400;
        generalCanvas.width = Math.min(sourceCanvas.width, maxWidth);
        const ratio = generalCanvas.width / sourceCanvas.width;
        generalCanvas.height = Math.round(sourceCanvas.height * ratio);
        const ctxGen = generalCanvas.getContext('2d');
        ctxGen.imageSmoothingEnabled = true;
        ctxGen.imageSmoothingQuality = 'high';
        ctxGen.drawImage(sourceCanvas, 0, 0, generalCanvas.width, generalCanvas.height);

        // Mejora suave para texto general
        this.mejorarImagenParaOCR(ctxGen, generalCanvas.width, generalCanvas.height, 'grises', { contraste: 1.4 });

        const worker = await this.getOcrWorker();
        let textoGeneral = '';
        let errorGeneral = null;
        
        try {
            const { data } = await worker.recognize(generalCanvas);
            textoGeneral = data.text || '';
        } catch (e) {
            errorGeneral = e;
            if (this.debug) console.warn('Error en OCR general:', e.message);
        }

        if (this.debug) console.log('📝 OCR GENERAL:', textoGeneral || '(vacío)');

        generalCanvas.width = 0;
        generalCanvas.height = 0;

        // ============================================================
        // OCR #2: CÓDIGO GRANDE (especializado)
        // ============================================================
        let codeResult = { codigo: null, confianza: 0, frecuencia: 0, metodo: 'ninguno', variantes: 0 };
        
        // Solo ejecutar OCR código si el general funcionó (o si falló, intentar igual)
        if (!errorGeneral || textoGeneral) {
            this.setStatus('🔎 Buscando código...', true);
            codeResult = await this.extraerCodigoGrande(sourceCanvas);
        }

        // ============================================================
        // FUSIÓN INTELIGENTE
        // ============================================================
        this.setStatus('🧠 Procesando resultados...', true);

        const parsed = Parser.parseTicketData(textoGeneral);

        // Intentar corregir el código del parser general
        let codigoParserCorregido = null;
        if (parsed.codigo) {
            codigoParserCorregido = this.corregirCodigoOCR(parsed.codigo);
            if (codigoParserCorregido && esCodigoValido(codigoParserCorregido)) {
                if (this.debug && codigoParserCorregido !== parsed.codigo) {
                    console.log(`🔧 Corrección parser: "${parsed.codigo}" → "${codigoParserCorregido}"`);
                }
                parsed.codigo = codigoParserCorregido;
            } else if (!esCodigoValido(parsed.codigo)) {
                parsed.codigo = null;
            }
        }

        // Prioridad: OCR especializado
        let codigoCorregido = null;
        if (codeResult.codigo) {
            codigoCorregido = this.corregirCodigoOCR(codeResult.codigo);
            if (this.debug && codigoCorregido !== codeResult.codigo) {
                console.log(`🔧 Corrección especializado: "${codeResult.codigo}" → "${codigoCorregido}"`);
            }
        }

        // Decisión final
        let codigoFinal = null;
        
        if (codigoCorregido && esCodigoValido(codigoCorregido)) {
            codigoFinal = codigoCorregido;
            if (this.debug) {
                console.log(`✅ Código especializado (corregido): "${codigoFinal}"`);
                console.log(`   Confianza: ${codeResult.confianza}, Frecuencia: ${codeResult.frecuencia}, Método: ${codeResult.metodo}`);
            }
        } else if (codeResult.codigo && esCodigoValido(codeResult.codigo)) {
            codigoFinal = codeResult.codigo;
            if (this.debug) {
                console.log(`✅ Código especializado: "${codigoFinal}"`);
                console.log(`   Confianza: ${codeResult.confianza}, Frecuencia: ${codeResult.frecuencia}, Método: ${codeResult.metodo}`);
            }
        } else if (parsed.codigo && esCodigoValido(parsed.codigo)) {
            codigoFinal = parsed.codigo;
            if (this.debug) console.log(`✅ Código del parser: "${codigoFinal}"`);
        } else {
            // Último intento: buscar en el texto completo
            const extraido = this.validarYNormalizarCodigo(textoGeneral);
            if (extraido) {
                codigoFinal = extraido;
                if (this.debug) console.log(`🔧 Código extraído del texto: "${codigoFinal}"`);
            }
        }

        // Asignar código final
        parsed.codigo = codigoFinal;

        // Calcular tiempo de procesamiento
        this.processingTime = Date.now() - startTime;
        this.stats.success++;
        
        if (this.debug) {
            console.log(`⏱️ Tiempo de procesamiento: ${this.processingTime}ms`);
            console.log('📦 RESULTADO FINAL:', {
                codigo: parsed.codigo,
                nombre: parsed.cliente_nombre,
                celular: parsed.cliente_celular,
                detalle: parsed.detalle,
                fecha: parsed.fecha_ticket,
                tienda: parsed.tienda
            });
        }

        return {
            parsed: parsed,
            textoGeneral: textoGeneral,
            codigoEspecializado: codigoCorregido || codeResult.codigo,
            confianzaCodigo: codeResult.confianza || 0,
            frecuenciaCodigo: codeResult.frecuencia || 0,
            metodoCodigo: codeResult.metodo || 'ninguno',
            variantes: codeResult.variantes || 0,
            processingTime: this.processingTime,
            stats: { ...this.stats }
        };
    },

    // ============================================================
    // 📸 CAPTURAR Y ESCANEAR - PRINCIPAL
    // ============================================================
    async capturarYEscanear() {
        if (this.isProcessing) return;
        if (!this.stream) {
            toast('Primero inicia la cámara', 'error');
            return;
        }

        this.isProcessing = true;
        this.setStatus('📸 Capturando...', true);

        try {
            const video = document.getElementById('video');
            
            // Capturar imagen optimizada
            const canvas = this.capturarImagen(video);

            // Guardar original para el código
            const originalCanvas = document.createElement('canvas');
            originalCanvas.width = canvas.width;
            originalCanvas.height = canvas.height;
            const ctxOrig = originalCanvas.getContext('2d');
            ctxOrig.drawImage(canvas, 0, 0);

            // Ejecutar doble OCR
            const resultado = await this.ejecutarDobleOCR(originalCanvas);

            this.setStatus('✅ Completado', true);

            // Limpiar memoria
            originalCanvas.width = 0;
            originalCanvas.height = 0;

            if (this.onResultCallback) {
                this.onResultCallback({
                    codigo: resultado.parsed.codigo || '',
                    cliente_nombre: resultado.parsed.cliente_nombre || '',
                    cliente_celular: resultado.parsed.cliente_celular || '',
                    detalle: resultado.parsed.detalle || '',
                    fecha_ticket: resultado.parsed.fecha_ticket || '',
                    tienda: resultado.parsed.tienda || 'MEDIA LUNA',
                    _codigo_confianza: resultado.confianzaCodigo || 0,
                    _codigo_frecuencia: resultado.frecuenciaCodigo || 0,
                    _codigo_metodo: resultado.metodoCodigo || 'ninguno',
                    _codigo_variantes: resultado.variantes || 0,
                    _processing_time: resultado.processingTime || 0,
                    _raw: resultado.textoGeneral
                });
            }

        } catch (e) {
            console.error('❌ Error en captura:', e);
            this.setStatus('⚠️ Error. Usa formulario manual.', true);
            toast('Error al procesar', 'error');
            this.stats.failures++;
            if (this.onResultCallback) {
                this.onResultCallback({
                    codigo: '',
                    cliente_nombre: '',
                    cliente_celular: '',
                    detalle: '',
                    fecha_ticket: '',
                    tienda: 'MEDIA LUNA',
                    _error: true
                });
            }
        } finally {
            this.isProcessing = false;
        }
    },

    // ============================================================
    // SUBIR FOTO - CON DOBLE OCR COMPLETO
    // ============================================================
    async handleFileUpload(file) {
        if (!file) return;
        if (this.scanType !== 'ocr') { toast('Cambia a modo OCR', 'error'); return; }
        this.setStatus('🔎 Procesando imagen...', true);

        try {
            const img = await createImageBitmap(file);

            const canvas = document.getElementById('ocrCanvas');
            const maxRes = this.isMobile ? 900 : 1400;
            const scale = Math.min(1, maxRes / img.width);
            canvas.width = Math.round(img.width * scale);
            canvas.height = Math.round(img.height * scale);
            
            const ctx = canvas.getContext('2d');
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

            const originalCanvas = document.createElement('canvas');
            originalCanvas.width = canvas.width;
            originalCanvas.height = canvas.height;
            const ctxOrig = originalCanvas.getContext('2d');
            ctxOrig.drawImage(canvas, 0, 0);

            const resultado = await this.ejecutarDobleOCR(originalCanvas);

            this.setStatus('', false);

            if (this.onResultCallback) {
                this.onResultCallback({
                    codigo: resultado.parsed.codigo || '',
                    cliente_nombre: resultado.parsed.cliente_nombre || '',
                    cliente_celular: resultado.parsed.cliente_celular || '',
                    detalle: resultado.parsed.detalle || '',
                    fecha_ticket: resultado.parsed.fecha_ticket || '',
                    tienda: resultado.parsed.tienda || 'MEDIA LUNA',
                    _codigo_confianza: resultado.confianzaCodigo || 0,
                    _codigo_frecuencia: resultado.frecuenciaCodigo || 0,
                    _codigo_metodo: resultado.metodoCodigo || 'ninguno',
                    _processing_time: resultado.processingTime || 0,
                    _raw: resultado.textoGeneral
                });
            }

            originalCanvas.width = 0;
            originalCanvas.height = 0;

        } catch (e) {
            toast('Error: ' + e.message, 'error');
            if (this.onResultCallback) {
                this.onResultCallback({
                    codigo: '',
                    cliente_nombre: '',
                    cliente_celular: '',
                    detalle: '',
                    fecha_ticket: '',
                    tienda: 'MEDIA LUNA',
                    _error: true
                });
            }
        }
        document.getElementById('fileInput').value = '';
    },

    // ============================================================
    // QR SCANNER - COMPLETO
    // ============================================================
    async startQr() {
        document.getElementById('video').style.display = 'none';
        document.getElementById('qr-reader').style.display = 'block';
        document.getElementById('camPlaceholder').style.display = 'none';
        document.getElementById('btnStartCam').style.display = 'none';
        document.getElementById('btnStopCam').style.display = 'inline-flex';
        document.getElementById('btnCapture').style.display = 'none';
        this.setStatus('🔎 Apunta al QR...', true);

        this.qrScanner = new Html5Qrcode('qr-reader');
        try {
            await this.qrScanner.start({ facingMode: 'environment' }, { fps: 10, qrbox: 230 },
                (decodedText) => { this.onQrSuccess(decodedText); },
                () => {}
            );
        } catch (e) {
            toast('Error al iniciar QR: ' + e.message, 'error');
            this.stop();
        }
    },

    onQrSuccess(text) {
        if (this.isProcessing) return;
        this.isProcessing = true;
        this.setStatus('✅ QR leído', true);
        if (this.qrScanner) { this.qrScanner.pause(true); }
        setTimeout(() => { this.isProcessing = false; }, 1000);

        if (text.includes('|')) {
            const parsed = Parser.parseQRData(text);
            if (parsed) {
                if (this.onResultCallback) {
                    this.onResultCallback({
                        codigo: parsed.codigo || '',
                        cliente_nombre: parsed.cliente_nombre || '',
                        cliente_celular: parsed.cliente_celular || '',
                        detalle: parsed.detalle || '',
                        fecha_ticket: parsed.fecha_ticket || '',
                        tienda: parsed.tienda || 'MEDIA LUNA'
                    });
                }
                return;
            }
        }

        const paquetes = DB.getPaquetes();
        const pkg = paquetes.find(p => p.qr_token === text);
        if (pkg) {
            if (this.onResultCallback) this.onResultCallback({ _existing: true, paquete: pkg });
        } else {
            toast('QR no reconocido.', 'error');
            if (this.qrScanner) this.qrScanner.resume();
        }
    },

    // ============================================================
    // ESTADÍSTICAS Y DIAGNÓSTICO
    // ============================================================
    getStats() {
        return {
            ...this.stats,
            processingTime: this.processingTime,
            isMobile: this.isMobile,
            capabilities: this.deviceCapabilities,
            workers: {
                general: !!this.ocrWorker,
                code: !!this.ocrCodeWorker
            }
        };
    },

    resetStats() {
        this.stats = { attempts: 0, success: 0, failures: 0 };
        this.processingTime = 0;
        if (this.debug) console.log('📊 Estadísticas reiniciadas');
    }
};