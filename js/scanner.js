/**
 * SCANNER - Gestión de cámara, OCR y QR
 * VERSIÓN FINAL - Con DOBLE OCR ESPECIALIZADO
 *
 * ARQUITECTURA:
 * 1. OCR GENERAL: imagen completa → texto normal (nombre, fecha, detalle, celular)
 * 2. OCR CÓDIGO: ROI escalonado → múltiples variantes → votación → código
 * 3. FUSIÓN: código del OCR especializado tiene prioridad
 *
 * MEJORAS APLICADAS:
 * - ROI escalonado (principal → ampliado → fallback)
 * - Early exit con criterio de confianza
 * - Workers reutilizables
 * - Función centralizada ejecutarDobleOCR()
 * - Múltiples umbrales para diferentes iluminaciones
 * - Liberación de memoria de canvas
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
    debug: true, // Cambiar a false para silenciar logs

    // ------------------------------------------------------------
    // INICIALIZACIÓN
    // ------------------------------------------------------------
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

    // ------------------------------------------------------------
    // CÁMARA
    // ------------------------------------------------------------
    async startCamera() {
        document.getElementById('scanResultBox').innerHTML = '';
        if (this.scanType === 'qr') { return this.startQr(); }

        try {
            const constraints = this.currentDeviceId ?
                { video: { deviceId: { exact: this.currentDeviceId } } } :
                { video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } } };
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

    // ------------------------------------------------------------
    // WORKERS OCR (REUTILIZABLES)
    // ------------------------------------------------------------
    async getOcrWorker() {
        if (!this.ocrWorker) {
            this.setStatus('⏳ Cargando OCR general...', true);
            if (this.debug) console.log('⏳ Creando worker OCR general...');
            this.ocrWorker = await Tesseract.createWorker('spa');
            if (this.debug) console.log('✅ Worker OCR general listo');
        }
        return this.ocrWorker;
    },

    async getOcrCodeWorker() {
        if (!this.ocrCodeWorker) {
            this.setStatus('⏳ Cargando OCR de código...', true);
            if (this.debug) console.log('⏳ Creando worker OCR código...');
            this.ocrCodeWorker = await Tesseract.createWorker('eng');
            // Configuración específica: SOLO letras mayúsculas y números
            await this.ocrCodeWorker.setParameters({
                tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
                tessedit_pageseg_mode: Tesseract.PSM.SINGLE_WORD
            });
            if (this.debug) console.log('✅ Worker OCR código listo (whitelist: A-Z,0-9)');
        }
        return this.ocrCodeWorker;
    },

    // ------------------------------------------------------------
    // PREPARAR CANVAS PARA OCR GENERAL (texto normal)
    // ------------------------------------------------------------
    prepararCanvasGeneral(source, srcWidth, srcHeight) {
        const canvas = document.getElementById('ocrCanvas');
        const targetWidth = 1400;
        const scale = Math.min(2.2, targetWidth / srcWidth) || 1;
        canvas.width = Math.max(1, Math.round(srcWidth * scale));
        canvas.height = Math.max(1, Math.round(srcHeight * scale));
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(source, 0, 0, canvas.width, canvas.height);

        // Escala de grises + contraste moderado (NO binarización)
        const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const d = imgData.data;
        const contrast = 1.25;
        for (let i = 0; i < d.length; i += 4) {
            let gray = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
            gray = (gray - 128) * contrast + 128;
            gray = Math.max(0, Math.min(255, gray));
            d[i] = d[i + 1] = d[i + 2] = gray;
        }
        ctx.putImageData(imgData, 0, 0);
        return canvas;
    },

    // ------------------------------------------------------------
    // 📸 FUNCIÓN CENTRALIZADA: DOBLE OCR
    // ------------------------------------------------------------
    async ejecutarDobleOCR(sourceCanvas) {
        if (this.debug) {
            console.log(`📐 Imagen: ${sourceCanvas.width}x${sourceCanvas.height}`);
        }

        // ============================================================
        // OCR #1: GENERAL (texto normal)
        // ============================================================
        this.setStatus('🔎 Analizando texto general...', true);

        const generalCanvas = document.createElement('canvas');
        generalCanvas.width = sourceCanvas.width;
        generalCanvas.height = sourceCanvas.height;
        const ctxGen = generalCanvas.getContext('2d');
        ctxGen.drawImage(sourceCanvas, 0, 0);

        const imgDataGen = ctxGen.getImageData(0, 0, generalCanvas.width, generalCanvas.height);
        const dGen = imgDataGen.data;
        const contrast = 1.3;
        for (let i = 0; i < dGen.length; i += 4) {
            let gray = 0.299 * dGen[i] + 0.587 * dGen[i + 1] + 0.114 * dGen[i + 2];
            gray = (gray - 128) * contrast + 128;
            gray = Math.max(0, Math.min(255, gray));
            dGen[i] = dGen[i + 1] = dGen[i + 2] = gray;
        }
        ctxGen.putImageData(imgDataGen, 0, 0);

        const worker = await this.getOcrWorker();
        const { data } = await worker.recognize(generalCanvas);
        const textoGeneral = data.text || '';

        if (this.debug) console.log('📝 OCR GENERAL:', textoGeneral);

        // Liberar memoria
        generalCanvas.width = 0;
        generalCanvas.height = 0;

        // ============================================================
        // OCR #2: CÓDIGO GRANDE (especializado)
        // ============================================================
        this.setStatus('🔎 Buscando código grande...', true);
        const codeResult = await this.extraerCodigoGrande(sourceCanvas);

        // ============================================================
        // FUSIÓN
        // ============================================================
        this.setStatus('🧠 Combinando resultados...', true);

        const parsed = Parser.parseTicketData(textoGeneral);

        if (codeResult.codigo && esCodigoValido(codeResult.codigo)) {
            parsed.codigo = codeResult.codigo;
            if (this.debug) {
                console.log(`✅ Código del OCR especializado: "${codeResult.codigo}"`);
                console.log(`   Confianza: ${codeResult.confianza}, Frecuencia: ${codeResult.frecuencia}, Método: ${codeResult.metodo}`);
            }
        } else {
            if (!parsed.codigo || !esCodigoValido(parsed.codigo)) {
                parsed.codigo = null;
            }
            if (this.debug) console.log(`⚠️ OCR especializado falló, usando parser general`);
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
            codigoEspecializado: codeResult.codigo,
            confianzaCodigo: codeResult.confianza || 0,
            frecuenciaCodigo: codeResult.frecuencia || 0,
            metodoCodigo: codeResult.metodo || 'ninguno'
        };
    },

    // ------------------------------------------------------------
    // 🔍 OCR ESPECIALIZADO PARA CÓDIGO GRANDE (con ROI escalonado)
    // ------------------------------------------------------------
    async extraerCodigoGrande(sourceCanvas) {
        const vW = sourceCanvas.width;
        const vH = sourceCanvas.height;

        // ============================================================
        // ESTRATEGIA ESCALONADA DE ROI
        // ============================================================
        const rois = [
            // ROI 1: Principal (donde normalmente está el código)
            {
                x: vW * 0.08,
                y: vH * 0.03,
                w: vW * 0.84,
                h: vH * 0.30,
                nombre: 'principal'
            },
            // ROI 2: Ampliado (más espacio)
            {
                x: vW * 0.05,
                y: vH * 0.01,
                w: vW * 0.90,
                h: vH * 0.45,
                nombre: 'ampliado'
            },
            // ROI 3: Muy amplio (fallback)
            {
                x: vW * 0.02,
                y: vH * 0.01,
                w: vW * 0.96,
                h: vH * 0.50,
                nombre: 'fallback'
            }
        ];

        let mejorResultado = null;
        let mejorConfianza = 0;
        let metodoUsado = null;

        // ============================================================
        // PROCESAR CADA ROI HASTA ENCONTRAR UN BUEN RESULTADO
        // ============================================================
        for (const roi of rois) {
            if (this.debug) {
                console.log(`📐 Probando ROI "${roi.nombre}": ${roi.x.toFixed(0)},${roi.y.toFixed(0)} ${roi.w.toFixed(0)}x${roi.h.toFixed(0)}`);
            }

            // Extraer ROI
            const roiCanvas = document.createElement('canvas');
            const escala = 3.5;
            roiCanvas.width = Math.round(roi.w * escala);
            roiCanvas.height = Math.round(roi.h * escala);
            const ctx = roiCanvas.getContext('2d');
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(
                sourceCanvas,
                roi.x, roi.y, roi.w, roi.h,
                0, 0, roiCanvas.width, roiCanvas.height
            );

            // Procesar variantes de este ROI
            const resultadoRoi = await this.procesarVariantesCodigo(roiCanvas, roi.nombre);

            // Liberar memoria
            roiCanvas.width = 0;
            roiCanvas.height = 0;

            // Si encontramos un código válido con buena confianza, terminamos
            if (resultadoRoi.codigo && esCodigoValido(resultadoRoi.codigo)) {
                const confianza = resultadoRoi.confianza || 0;
                // Si la confianza es alta (>70%) o es el primer ROI, lo aceptamos
                if (confianza > 70 || roi.nombre === 'principal') {
                    if (this.debug) {
                        console.log(`✅ ROI "${roi.nombre}" encontró: "${resultadoRoi.codigo}" (conf: ${confianza})`);
                        console.log(`🛑 Early exit - no se procesan más ROIs`);
                    }
                    return {
                        codigo: resultadoRoi.codigo,
                        confianza: confianza,
                        frecuencia: resultadoRoi.frecuencia || 1,
                        metodo: roi.nombre,
                        intentos: rois.indexOf(roi) + 1
                    };
                }

                // Guardar como mejor resultado hasta ahora
                if (confianza > mejorConfianza) {
                    mejorConfianza = confianza;
                    mejorResultado = resultadoRoi;
                    metodoUsado = roi.nombre;
                }
            }
        }

        // Si ningún ROI dio un código válido, devolver el mejor encontrado
        if (mejorResultado && mejorResultado.codigo) {
            if (this.debug) {
                console.log(`⚠️ Usando mejor resultado de ROI "${metodoUsado}": "${mejorResultado.codigo}" (conf: ${mejorConfianza})`);
            }
            return {
                codigo: mejorResultado.codigo,
                confianza: mejorConfianza,
                frecuencia: mejorResultado.frecuencia || 1,
                metodo: metodoUsado || 'fallback',
                intentos: rois.length
            };
        }

        if (this.debug) console.log('❌ No se detectó código válido en ningún ROI');
        return { codigo: null, confianza: 0, frecuencia: 0, metodo: 'ninguno', intentos: rois.length };
    },

    // ------------------------------------------------------------
    // PROCESAR VARIANTES DE UN ROI
    // ------------------------------------------------------------
    async procesarVariantesCodigo(roiCanvas, roiNombre) {
        const resultados = [];
        const workerCode = await this.getOcrCodeWorker();

        // ============================================================
        // VARIANTE 1: Contraste fuerte + binarización agresiva
        // ============================================================
        const v1 = document.createElement('canvas');
        v1.width = roiCanvas.width;
        v1.height = roiCanvas.height;
        const ctx1 = v1.getContext('2d');
        ctx1.drawImage(roiCanvas, 0, 0);
        const imgData1 = ctx1.getImageData(0, 0, v1.width, v1.height);
        const d1 = imgData1.data;
        // Umbral 110 (más agresivo, para letras gruesas)
        for (let i = 0; i < d1.length; i += 4) {
            const gray = 0.299 * d1[i] + 0.587 * d1[i + 1] + 0.114 * d1[i + 2];
            let val = (gray - 128) * 2.2 + 128;
            val = Math.max(0, Math.min(255, val));
            d1[i] = d1[i + 1] = d1[i + 2] = val > 110 ? 255 : 0;
        }
        ctx1.putImageData(imgData1, 0, 0);

        try {
            const result = await workerCode.recognize(v1);
            const texto = result.data.text.trim();
            const confianza = result.data.confidence || 0;
            if (texto) resultados.push({ texto, confianza, variante: 'contraste_alto' });
            if (this.debug) console.log(`   📊 Variante "contraste_alto": "${texto}" (conf: ${confianza})`);
        } catch (e) { if (this.debug) console.warn('Error en variante:', e); }
        v1.width = 0;
        v1.height = 0;

        // ============================================================
        // VARIANTE 2: Binarización suave (umbral 135)
        // ============================================================
        const v2 = document.createElement('canvas');
        v2.width = roiCanvas.width;
        v2.height = roiCanvas.height;
        const ctx2 = v2.getContext('2d');
        ctx2.drawImage(roiCanvas, 0, 0);
        const imgData2 = ctx2.getImageData(0, 0, v2.width, v2.height);
        const d2 = imgData2.data;
        for (let i = 0; i < d2.length; i += 4) {
            const gray = 0.299 * d2[i] + 0.587 * d2[i + 1] + 0.114 * d2[i + 2];
            d2[i] = d2[i + 1] = d2[i + 2] = gray > 135 ? 255 : 0;
        }
        ctx2.putImageData(imgData2, 0, 0);

        try {
            const result = await workerCode.recognize(v2);
            const texto = result.data.text.trim();
            const confianza = result.data.confidence || 0;
            if (texto) resultados.push({ texto, confianza, variante: 'binarizacion_suave' });
            if (this.debug) console.log(`   📊 Variante "binarizacion_suave": "${texto}" (conf: ${confianza})`);
        } catch (e) { if (this.debug) console.warn('Error en variante:', e); }
        v2.width = 0;
        v2.height = 0;

        // ============================================================
        // VARIANTE 3: Invertida (para tickets oscuros)
        // ============================================================
        const v3 = document.createElement('canvas');
        v3.width = roiCanvas.width;
        v3.height = roiCanvas.height;
        const ctx3 = v3.getContext('2d');
        ctx3.drawImage(roiCanvas, 0, 0);
        const imgData3 = ctx3.getImageData(0, 0, v3.width, v3.height);
        const d3 = imgData3.data;
        for (let i = 0; i < d3.length; i += 4) {
            const gray = 0.299 * d3[i] + 0.587 * d3[i + 1] + 0.114 * d3[i + 2];
            const val = gray > 135 ? 0 : 255;
            d3[i] = d3[i + 1] = d3[i + 2] = val;
        }
        ctx3.putImageData(imgData3, 0, 0);

        try {
            const result = await workerCode.recognize(v3);
            const texto = result.data.text.trim();
            const confianza = result.data.confidence || 0;
            if (texto) resultados.push({ texto, confianza, variante: 'invertida' });
            if (this.debug) console.log(`   📊 Variante "invertida": "${texto}" (conf: ${confianza})`);
        } catch (e) { if (this.debug) console.warn('Error en variante:', e); }
        v3.width = 0;
        v3.height = 0;

        // ============================================================
        // VARIANTE 4: Sin binarización (solo grises + contraste)
        // ============================================================
        const v4 = document.createElement('canvas');
        v4.width = roiCanvas.width;
        v4.height = roiCanvas.height;
        const ctx4 = v4.getContext('2d');
        ctx4.drawImage(roiCanvas, 0, 0);
        const imgData4 = ctx4.getImageData(0, 0, v4.width, v4.height);
        const d4 = imgData4.data;
        for (let i = 0; i < d4.length; i += 4) {
            let gray = 0.299 * d4[i] + 0.587 * d4[i + 1] + 0.114 * d4[i + 2];
            gray = (gray - 128) * 1.8 + 128;
            gray = Math.max(0, Math.min(255, gray));
            d4[i] = d4[i + 1] = d4[i + 2] = gray;
        }
        ctx4.putImageData(imgData4, 0, 0);

        try {
            const result = await workerCode.recognize(v4);
            const texto = result.data.text.trim();
            const confianza = result.data.confidence || 0;
            if (texto) resultados.push({ texto, confianza, variante: 'grises_contraste' });
            if (this.debug) console.log(`   📊 Variante "grises_contraste": "${texto}" (conf: ${confianza})`);
        } catch (e) { if (this.debug) console.warn('Error en variante:', e); }
        v4.width = 0;
        v4.height = 0;

        // ============================================================
        // SELECCIONAR EL MEJOR RESULTADO DE ESTE ROI
        // ============================================================
        if (resultados.length === 0) {
            return { codigo: null, confianza: 0, frecuencia: 0 };
        }

        // Normalizar y validar cada resultado
        const validos = [];
        for (const r of resultados) {
            const normalizado = normalizeCodigo(r.texto);
            if (esCodigoValido(normalizado)) {
                validos.push({
                    original: r.texto,
                    normalizado: normalizado,
                    confianza: r.confianza,
                    variante: r.variante
                });
            }
        }

        // Si no hay códigos válidos, intentar extraer de texto no válido
        if (validos.length === 0) {
            for (const r of resultados) {
                const extraido = this.extraerCodigoDeTexto(r.texto);
                if (extraido) {
                    validos.push({
                        original: r.texto,
                        normalizado: extraido,
                        confianza: r.confianza * 0.8,
                        variante: r.variante + '_extraido'
                    });
                }
            }
        }

        if (validos.length === 0) {
            return { codigo: null, confianza: 0, frecuencia: 0 };
        }

        // Votación por frecuencia
        const frecuencias = {};
        for (const v of validos) {
            frecuencias[v.normalizado] = (frecuencias[v.normalizado] || 0) + 1;
        }

        let mejor = validos[0];
        for (const v of validos) {
            if (frecuencias[v.normalizado] > frecuencias[mejor.normalizado]) {
                mejor = v;
            }
            if (frecuencias[v.normalizado] === frecuencias[mejor.normalizado] &&
                v.confianza > mejor.confianza) {
                mejor = v;
            }
        }

        return {
            codigo: mejor.normalizado,
            confianza: mejor.confianza,
            frecuencia: frecuencias[mejor.normalizado] || 1
        };
    },

    // ------------------------------------------------------------
    // EXTRAER CÓDIGO DE TEXTO (fallback)
    // ------------------------------------------------------------
    extraerCodigoDeTexto(texto) {
        if (!texto) return null;
        // Buscar patrón letra+número
        const m = texto.match(/([A-Z])\s*(\d{1,4})/i);
        if (m) {
            const cand = normalizeCodigo(m[1] + m[2]);
            if (esCodigoValido(cand)) return cand;
        }
        // Buscar en texto limpio
        const limpio = texto.replace(/[^A-Z0-9]/gi, '').toUpperCase();
        const m2 = limpio.match(/([A-Z])(\d{1,4})/);
        if (m2) {
            const cand = normalizeCodigo(m2[1] + m2[2]);
            if (esCodigoValido(cand)) return cand;
        }
        return null;
    },

    // ------------------------------------------------------------
    // 📸 CAPTURAR Y ESCANEAR
    // ------------------------------------------------------------
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

            // Capturar en alta resolución
            const canvas = document.getElementById('ocrCanvas');
            const vW = video.videoWidth;
            const vH = video.videoHeight;
            const scale = Math.min(1.8, 1600 / vW) || 1;
            canvas.width = Math.round(vW * scale);
            canvas.height = Math.round(vH * scale);
            const ctx = canvas.getContext('2d');
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

            // Guardar original para el código (sin procesar)
            const originalCanvas = document.createElement('canvas');
            originalCanvas.width = canvas.width;
            originalCanvas.height = canvas.height;
            const ctxOrig = originalCanvas.getContext('2d');
            ctxOrig.drawImage(canvas, 0, 0);

            // Usar la función centralizada
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
                    _raw: resultado.textoGeneral
                });
            }

            // Limpiar canvas
            originalCanvas.width = 0;
            originalCanvas.height = 0;

        } catch (e) {
            console.error('Error en captura:', e);
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

    // ------------------------------------------------------------
    // SUBIR FOTO
    // ------------------------------------------------------------
    async handleFileUpload(file) {
        if (!file) return;
        if (this.scanType !== 'ocr') { toast('Cambia a modo OCR', 'error'); return; }
        this.setStatus('🔎 Procesando imagen...', true);

        try {
            const img = await createImageBitmap(file);

            const canvas = document.getElementById('ocrCanvas');
            const scale = Math.min(1.8, 1600 / img.width) || 1;
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

    // ------------------------------------------------------------
    // QR SCANNER (sin cambios)
    // ------------------------------------------------------------
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