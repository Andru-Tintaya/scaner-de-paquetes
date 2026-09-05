/**
 * SCANNER - Gestión de cámara, OCR y QR con DOBLE OCR ESPECIALIZADO
 * VERSIÓN MEJORADA - Robusta y optimizada para celular
 * 
 * ARQUITECTURA:
 * 1. OCR GENERAL: imagen completa → texto normal
 * 2. OCR CÓDIGO: ROI escalonado + múltiples variantes + votación
 * 3. FUSIÓN: código del OCR especializado tiene prioridad
 * 
 * OPTIMIZACIONES:
 * - Workers reutilizables con timeout
 * - Procesamiento por lotes de variantes
 * - Early exit inteligente
 * - Liberación de memoria
 * - Logs detallados con debug toggle
 */

const Scanner = {
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
    workerTimeout: 30000, // 30 segundos timeout para workers

    init(onResult) {
        this.onResultCallback = onResult || function () {};
        if (this.debug) console.log('🔍 Scanner inicializado (debug ON)');
    },

    setMode(mode) {
        this.scanMode = mode;
        document.getElementById('modeRegistro').classList.toggle('active', mode === 'registro');
        document.getElementById('modeConsulta').classList.toggle('active', mode === 'consulta');
        document.getElementById('scanResultBox').innerHTML = '';
    },

    setType(type) {
        if (this.stream || this.qrScanner) this.stop();
        this.scanType = type;
        document.getElementById('typeOcr').classList.toggle('active', type === 'ocr');
        document.getElementById('typeQr').classList.toggle('active', type === 'qr');
        document.getElementById('scanResultBox').innerHTML = '';
    },

    async startCamera() {
        document.getElementById('scanResultBox').innerHTML = '';
        if (this.scanType === 'qr') { return this.startQr(); }

        try {
            const constraints = this.currentDeviceId ?
                { video: { deviceId: { exact: this.currentDeviceId } } } :
                { video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } } };
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

        this.setStatus('✅ Cámara lista. Presiona "Capturar y Escanear"', true);
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
    // WORKERS OCR CON TIMEOUT Y REUTILIZACIÓN
    // ============================================================
    async getOcrWorker() {
        if (!this.ocrWorker) {
            this.setStatus('⏳ Cargando OCR general...', true);
            if (this.debug) console.log('⏳ Creando worker OCR general...');
            
            const timeoutPromise = new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Timeout creando worker general')), this.workerTimeout)
            );
            
            this.ocrWorker = await Promise.race([
                Tesseract.createWorker('spa'),
                timeoutPromise
            ]);
            
            if (this.debug) console.log('✅ Worker OCR general listo');
        }
        return this.ocrWorker;
    },

    async getOcrCodeWorker() {
        if (!this.ocrCodeWorker) {
            this.setStatus('⏳ Cargando OCR de código...', true);
            if (this.debug) console.log('⏳ Creando worker OCR código...');
            
            const timeoutPromise = new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Timeout creando worker código')), this.workerTimeout)
            );
            
            this.ocrCodeWorker = await Promise.race([
                Tesseract.createWorker('eng'),
                timeoutPromise
            ]);
            
            // Configuración específica para código
            await this.ocrCodeWorker.setParameters({
                tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
                tessedit_pageseg_mode: '8' // SINGLE_WORD
            });
            
            if (this.debug) console.log('✅ Worker OCR código listo (whitelist: A-Z,0-9)');
        }
        return this.ocrCodeWorker;
    },

    // ============================================================
    // MEJORA DE IMAGEN - MULTI-ESTRATEGIA
    // ============================================================
    mejorarImagenParaOCR(ctx, w, h, estrategia) {
        const imgData = ctx.getImageData(0, 0, w, h);
        const d = imgData.data;
        
        switch (estrategia) {
            case 'contraste_fuerte':
                for (let i = 0; i < d.length; i += 4) {
                    let gray = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
                    gray = (gray - 128) * 2.5 + 128;
                    gray = Math.max(0, Math.min(255, gray));
                    const val = gray > 100 ? 255 : 0;
                    d[i] = d[i + 1] = d[i + 2] = val;
                }
                break;
                
            case 'contraste_medio':
                for (let i = 0; i < d.length; i += 4) {
                    let gray = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
                    gray = (gray - 128) * 1.8 + 128;
                    gray = Math.max(0, Math.min(255, gray));
                    const val = gray > 130 ? 255 : 0;
                    d[i] = d[i + 1] = d[i + 2] = val;
                }
                break;
                
            case 'grises':
                for (let i = 0; i < d.length; i += 4) {
                    let gray = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
                    gray = (gray - 128) * 1.5 + 128;
                    gray = Math.max(0, Math.min(255, gray));
                    d[i] = d[i + 1] = d[i + 2] = gray;
                }
                break;
                
            case 'invertida':
                for (let i = 0; i < d.length; i += 4) {
                    let gray = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
                    const val = gray > 130 ? 0 : 255;
                    d[i] = d[i + 1] = d[i + 2] = val;
                }
                break;
                
            default:
                // Sin procesamiento
                break;
        }
        
        ctx.putImageData(imgData, 0, 0);
    },

    // ============================================================
    // 🔍 OCR ESPECIALIZADO PARA CÓDIGO GRANDE - MEJORADO
    // ============================================================
    async extraerCodigoGrande(sourceCanvas) {
        const vW = sourceCanvas.width;
        const vH = sourceCanvas.height;
        
        if (this.debug) console.log(`📐 Procesando código en imagen ${vW}x${vH}`);

        // ROI escalonado - más tolerante
        const rois = [
            { x: vW * 0.05, y: vH * 0.02, w: vW * 0.90, h: vH * 0.28, nombre: 'principal', escala: 4.5 },
            { x: vW * 0.03, y: vH * 0.01, w: vW * 0.94, h: vH * 0.38, nombre: 'ampliado', escala: 4.0 },
            { x: vW * 0.02, y: vH * 0.01, w: vW * 0.96, h: vH * 0.45, nombre: 'fallback', escala: 3.5 }
        ];

        let todosResultados = [];
        let mejorGeneral = null;
        let mejorConfianza = 0;

        for (const roi of rois) {
            if (this.debug) {
                console.log(`📐 ROI "${roi.nombre}": ${roi.x.toFixed(0)},${roi.y.toFixed(0)} ${roi.w.toFixed(0)}x${roi.h.toFixed(0)}`);
            }

            // Extraer ROI
            const roiCanvas = document.createElement('canvas');
            const escala = roi.escala;
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

            // Guardar todos los resultados para análisis
            if (resultadosRoi.length > 0) {
                todosResultados = todosResultados.concat(resultadosRoi);
            }

            // Buscar el mejor resultado válido de este ROI
            const mejorDeRoi = this.encontrarMejorResultado(resultadosRoi);
            
            if (mejorDeRoi && mejorDeRoi.codigo && esCodigoValido(mejorDeRoi.codigo)) {
                const confianza = mejorDeRoi.confianza || 0;
                
                // Early exit: si confianza > 60% en ROI principal, terminar
                if (confianza > 60 && roi.nombre === 'principal') {
                    if (this.debug) {
                        console.log(`✅ ROI "${roi.nombre}" encontró: "${mejorDeRoi.codigo}" (conf: ${confianza})`);
                        console.log(`🛑 Early exit - no se procesan más ROIs`);
                    }
                    return {
                        codigo: mejorDeRoi.codigo,
                        confianza: confianza,
                        frecuencia: mejorDeRoi.frecuencia || 1,
                        metodo: roi.nombre,
                        intentos: rois.indexOf(roi) + 1,
                        variantes: resultadosRoi.length
                    };
                }
                
                // Guardar como mejor global
                if (confianza > mejorConfianza) {
                    mejorConfianza = confianza;
                    mejorGeneral = mejorDeRoi;
                }
            }
        }

        // Si encontramos un resultado válido en algún ROI
        if (mejorGeneral && mejorGeneral.codigo && esCodigoValido(mejorGeneral.codigo)) {
            if (this.debug) {
                console.log(`✅ Mejor resultado global: "${mejorGeneral.codigo}" (conf: ${mejorConfianza})`);
            }
            return {
                codigo: mejorGeneral.codigo,
                confianza: mejorConfianza,
                frecuencia: mejorGeneral.frecuencia || 1,
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
    // PROCESAR VARIANTES DE UN ROI - MEJORADO
    // ============================================================
    async procesarVariantesCodigo(roiCanvas, roiNombre) {
        const resultados = [];
        const workerCode = await this.getOcrCodeWorker();

        // Estrategias de procesamiento
        const estrategias = [
            { nombre: 'contraste_alto', metodo: 'contraste_fuerte' },
            { nombre: 'contraste_medio', metodo: 'contraste_medio' },
            { nombre: 'grises', metodo: 'grises' },
            { nombre: 'invertida', metodo: 'invertida' }
        ];

        for (const est of estrategias) {
            const canvas = document.createElement('canvas');
            canvas.width = roiCanvas.width;
            canvas.height = roiCanvas.height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(roiCanvas, 0, 0);
            
            // Aplicar mejora según estrategia
            this.mejorarImagenParaOCR(ctx, canvas.width, canvas.height, est.metodo);

            try {
                const result = await workerCode.recognize(canvas);
                const texto = result.data.text.trim();
                const confianza = result.data.confidence || 0;
                
                if (texto) {
                    resultados.push({
                        texto: texto,
                        confianza: confianza,
                        variante: est.nombre,
                        roi: roiNombre
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

        // Intentar con escalas adicionales
        const escalas = [1.5, 2.0];
        for (const esc of escalas) {
            const canvas = document.createElement('canvas');
            canvas.width = Math.round(roiCanvas.width * esc);
            canvas.height = Math.round(roiCanvas.height * esc);
            const ctx = canvas.getContext('2d');
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(roiCanvas, 0, 0, canvas.width, canvas.height);
            
            this.mejorarImagenParaOCR(ctx, canvas.width, canvas.height, 'contraste_medio');

            try {
                const result = await workerCode.recognize(canvas);
                const texto = result.data.text.trim();
                const confianza = result.data.confidence || 0;
                
                if (texto) {
                    resultados.push({
                        texto: texto,
                        confianza: confianza,
                        variante: 'escala_' + esc,
                        roi: roiNombre
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

        return resultados;
    },

    // ============================================================
    // ENCONTRAR EL MEJOR RESULTADO DE UNA LISTA
    // ============================================================
    encontrarMejorResultado(resultados) {
        if (!resultados || resultados.length === 0) return null;

        // Normalizar y validar
        const validos = [];
        for (const r of resultados) {
            const normalizado = normalizeCodigo(r.texto);
            if (esCodigoValido(normalizado)) {
                validos.push({
                    original: r.texto,
                    codigo: normalizado,
                    confianza: r.confianza,
                    variante: r.variante,
                    roi: r.roi
                });
            }
        }

        if (validos.length === 0) return null;

        // Votación por frecuencia
        const frecuencias = {};
        for (const v of validos) {
            frecuencias[v.codigo] = (frecuencias[v.codigo] || 0) + 1;
        }

        // Elegir el que aparece más veces, con mayor confianza
        let mejor = validos[0];
        for (const v of validos) {
            const freqV = frecuencias[v.codigo] || 0;
            const freqMejor = frecuencias[mejor.codigo] || 0;
            
            if (freqV > freqMejor) {
                mejor = v;
            } else if (freqV === freqMejor && v.confianza > mejor.confianza) {
                mejor = v;
            }
        }

        return {
            codigo: mejor.codigo,
            confianza: mejor.confianza,
            frecuencia: frecuencias[mejor.codigo] || 1,
            variante: mejor.variante,
            roi: mejor.roi
        };
    },

    // ============================================================
    // EXTRAER CÓDIGO DE RESULTADOS NO VÁLIDOS
    // ============================================================
    extraerCodigoDeResultados(resultados) {
        for (const r of resultados) {
            // Buscar patrón letra+número
            const m = r.texto.match(/([A-Z])\s*(\d{1,4})/i);
            if (m) {
                const cand = normalizeCodigo(m[1] + m[2]);
                if (esCodigoValido(cand)) return cand;
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
    // CORRECCIÓN DE ERRORES COMUNES DE OCR
    // ============================================================
    corregirCodigoOCR(texto) {
        if (!texto) return null;

        const correcciones = {
            'E': 'A', 'G': 'A', 'J': 'A', 'O': '0',
            'I': '1', 'L': '1', 'S': '5', 'B': '8',
            'Z': '2', 'D': '0', 'Q': '0', 'T': '1',
            'P': '9', 'R': '2', 'Y': '4', 'H': '4'
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

        // Intentar extraer patrón
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

        // Si tiene formato A4g (g parece 9)
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

        return null;
    },

    // ============================================================
    // 📸 FUNCIÓN CENTRALIZADA: DOBLE OCR MEJORADA
    // ============================================================
    async ejecutarDobleOCR(sourceCanvas) {
        if (this.debug) {
            console.log(`📐 Imagen: ${sourceCanvas.width}x${sourceCanvas.height}`);
        }

        // ============================================================
        // OCR #1: GENERAL (texto normal) - MEJORADO
        // ============================================================
        this.setStatus('🔎 Analizando texto general...', true);

        const generalCanvas = document.createElement('canvas');
        generalCanvas.width = Math.min(sourceCanvas.width, 1400);
        const ratio = generalCanvas.width / sourceCanvas.width;
        generalCanvas.height = Math.round(sourceCanvas.height * ratio);
        const ctxGen = generalCanvas.getContext('2d');
        ctxGen.imageSmoothingEnabled = true;
        ctxGen.imageSmoothingQuality = 'high';
        ctxGen.drawImage(sourceCanvas, 0, 0, generalCanvas.width, generalCanvas.height);

        // Mejora suave para texto general
        this.mejorarImagenParaOCR(ctxGen, generalCanvas.width, generalCanvas.height, 'grises');

        const worker = await this.getOcrWorker();
        let textoGeneral = '';
        try {
            const { data } = await worker.recognize(generalCanvas);
            textoGeneral = data.text || '';
        } catch (e) {
            if (this.debug) console.warn('Error en OCR general:', e);
        }

        if (this.debug) console.log('📝 OCR GENERAL:', textoGeneral || '(vacío)');

        generalCanvas.width = 0;
        generalCanvas.height = 0;

        // ============================================================
        // OCR #2: CÓDIGO GRANDE (especializado)
        // ============================================================
        this.setStatus('🔎 Buscando código grande...', true);
        const codeResult = await this.extraerCodigoGrande(sourceCanvas);

        // ============================================================
        // FUSIÓN INTELIGENTE
        // ============================================================
        this.setStatus('🧠 Combinando resultados...', true);

        const parsed = Parser.parseTicketData(textoGeneral);

        // Intentar corregir el código del parser general si existe
        let codigoParserCorregido = null;
        if (parsed.codigo) {
            codigoParserCorregido = this.corregirCodigoOCR(parsed.codigo);
            if (codigoParserCorregido && esCodigoValido(codigoParserCorregido)) {
                if (this.debug && codigoParserCorregido !== parsed.codigo) {
                    console.log(`🔧 Corrección OCR del parser: "${parsed.codigo}" → "${codigoParserCorregido}"`);
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
                console.log(`🔧 Corrección OCR especializado: "${codeResult.codigo}" → "${codigoCorregido}"`);
            }
        }

        // Decisión final: usar el especializado si es válido, sino el parser
        if (codigoCorregido && esCodigoValido(codigoCorregido)) {
            parsed.codigo = codigoCorregido;
            if (this.debug) {
                console.log(`✅ Código del OCR especializado (corregido): "${codigoCorregido}"`);
                console.log(`   Confianza: ${codeResult.confianza}, Frecuencia: ${codeResult.frecuencia}, Método: ${codeResult.metodo}`);
            }
        } else if (codeResult.codigo && esCodigoValido(codeResult.codigo)) {
            parsed.codigo = codeResult.codigo;
            if (this.debug) {
                console.log(`✅ Código del OCR especializado: "${codeResult.codigo}"`);
                console.log(`   Confianza: ${codeResult.confianza}, Frecuencia: ${codeResult.frecuencia}, Método: ${codeResult.metodo}`);
            }
        } else if (!parsed.codigo || !esCodigoValido(parsed.codigo)) {
            parsed.codigo = null;
            if (this.debug) console.log(`⚠️ No se detectó código válido`);
        }

        if (this.debug) {
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
            variantes: codeResult.variantes || 0
        };
    },

    // ============================================================
    // 📸 CAPTURAR Y ESCANEAR
    // ============================================================
    async capturarYEscanear() {
        if (this.isProcessing) return;
        if (!this.stream) {
            toast('Primero inicia la cámara', 'error');
            return;
        }

        this.isProcessing = true;
        this.setStatus('📸 Capturando imagen...', true);

        try {
            const video = document.getElementById('video');

            const canvas = document.getElementById('ocrCanvas');
            const vW = video.videoWidth;
            const vH = video.videoHeight;
            
            // Resolución equilibrada para celular
            const targetWidth = Math.min(vW, 1200);
            const scale = targetWidth / vW;
            canvas.width = targetWidth;
            canvas.height = Math.round(vH * scale);
            
            const ctx = canvas.getContext('2d');
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

            // Guardar original para el código
            const originalCanvas = document.createElement('canvas');
            originalCanvas.width = canvas.width;
            originalCanvas.height = canvas.height;
            const ctxOrig = originalCanvas.getContext('2d');
            ctxOrig.drawImage(canvas, 0, 0);

            const resultado = await this.ejecutarDobleOCR(originalCanvas);

            this.setStatus('✅ Escaneo completado', true);

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
                    _raw: resultado.textoGeneral
                });
            }

            originalCanvas.width = 0;
            originalCanvas.height = 0;

        } catch (e) {
            console.error('❌ Error en captura:', e);
            this.setStatus('⚠️ Error al escanear. Usa el formulario manual.', true);
            toast('Error al procesar la imagen', 'error');
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
    // SUBIR FOTO - CON DOBLE OCR
    // ============================================================
    async handleFileUpload(file) {
        if (!file) return;
        if (this.scanType !== 'ocr') { toast('Cambia a modo OCR', 'error'); return; }
        this.setStatus('🔎 Procesando imagen...', true);

        try {
            const img = await createImageBitmap(file);

            const canvas = document.getElementById('ocrCanvas');
            const targetWidth = Math.min(img.width, 1200);
            const scale = targetWidth / img.width;
            canvas.width = targetWidth;
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
    // QR SCANNER
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
    }
};