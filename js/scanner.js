/**
 * SCANNER - Gestión de cámara, OCR y QR
 * VERSIÓN OPTIMIZADA PARA CÓDIGO GIGANTE (A49, A10, etc.)
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

    // ============================================================
    // WORKERS OCR (REUTILIZABLES)
    // ============================================================
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
            await this.ocrCodeWorker.setParameters({
                tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
                tessedit_pageseg_mode: Tesseract.PSM.SINGLE_WORD,
                tessedit_ocr_engine_mode: Tesseract.OEM_LSTM_ONLY
            });
            if (this.debug) console.log('✅ Worker OCR código listo (whitelist: A-Z,0-9)');
        }
        return this.ocrCodeWorker;
    },

    // ============================================================
    // PREPARAR CANVAS PARA OCR GENERAL
    // ============================================================
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

    // ============================================================
    // 📸 FUNCIÓN CENTRALIZADA: DOBLE OCR
    // ============================================================
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

        // CORRECCIÓN: Si el OCR especializado detectó "E1" pero el código real es "A49"
        // Intentamos corregir errores comunes de OCR
        let codigoCorregido = null;
        if (codeResult.codigo) {
            codigoCorregido = this.corregirCodigoOCR(codeResult.codigo);
            if (this.debug && codigoCorregido !== codeResult.codigo) {
                console.log(`🔧 Corrección OCR: "${codeResult.codigo}" → "${codigoCorregido}"`);
            }
        }

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
            codigoEspecializado: codigoCorregido || codeResult.codigo,
            confianzaCodigo: codeResult.confianza || 0,
            frecuenciaCodigo: codeResult.frecuencia || 0,
            metodoCodigo: codeResult.metodo || 'ninguno'
        };
    },

    // ============================================================
    // 🔧 CORRECCIÓN DE ERRORES COMUNES DE OCR
    // ============================================================
    corregirCodigoOCR(texto) {
        if (!texto) return null;

        // Mapeo de confusiones visuales comunes
        const correcciones = {
            'E': 'A',   // E → A (muy común en A49)
            'EL': 'A',  // EL → A
            'J': 'A',   // J → A
            'G': 'A',   // G → A
            'O': '0',   // O → 0
            'I': '1',   // I → 1
            'L': '1',   // L → 1
            'S': '5',   // S → 5
            'B': '8',   // B → 8
            'Z': '2',   // Z → 2
            'G': '6',   // G → 6
            'T': '1',   // T → 1
            'Q': '0',   // Q → 0
            'D': '0'    // D → 0
        };

        // Primero normalizar
        let normalizado = texto.toUpperCase().replace(/[^A-Z0-9]/g, '');

        // Si es muy corto (1-2 caracteres), intentar corregir
        if (normalizado.length <= 2) {
            // Intentar reemplazar caracteres problemáticos
            let corregido = '';
            for (const char of normalizado) {
                corregido += correcciones[char] || char;
            }
            // Si después de corregir tenemos 2+ caracteres y empieza con letra
            if (corregido.length >= 2 && /^[A-Z]/.test(corregido)) {
                // Si el segundo carácter es número, devolver
                if (/\d/.test(corregido[1])) {
                    return corregido;
                }
            }
        }

        // Si parece un código pero con confusión visual
        // Ejemplo: "A4g" → "A49" (g parece 9)
        const m = normalizado.match(/^([A-Z])([A-Z]?)(\d*)$/);
        if (m) {
            const letter = correcciones[m[1]] || m[1];
            let digits = '';
            // Si el segundo carácter es una letra que parece número, corregir
            if (m[2]) {
                const digit = correcciones[m[2]] || m[2];
                if (/\d/.test(digit)) digits += digit;
            }
            digits += m[3] || '';
            if (digits.length >= 1) {
                const resultado = letter + digits;
                if (esCodigoValido(resultado)) return resultado;
            }
        }

        return normalizado;
    },

    // ============================================================
    // 🔍 OCR ESPECIALIZADO PARA CÓDIGO GRANDE
    // ============================================================
    async extraerCodigoGrande(sourceCanvas) {
        const vW = sourceCanvas.width;
        const vH = sourceCanvas.height;

        // ROI ajustado para capturar mejor el código
        const rois = [
            // ROI 1: Principal (zona del código)
            {
                x: vW * 0.05,
                y: vH * 0.02,
                w: vW * 0.90,
                h: vH * 0.25,
                nombre: 'principal'
            },
            // ROI 2: Ampliado
            {
                x: vW * 0.03,
                y: vH * 0.01,
                w: vW * 0.94,
                h: vH * 0.35,
                nombre: 'ampliado'
            }
        ];

        let mejorResultado = null;
        let mejorConfianza = 0;
        let metodoUsado = null;

        for (const roi of rois) {
            if (this.debug) {
                console.log(`📐 Probando ROI "${roi.nombre}": ${roi.x.toFixed(0)},${roi.y.toFixed(0)} ${roi.w.toFixed(0)}x${roi.h.toFixed(0)}`);
            }

            const roiCanvas = document.createElement('canvas');
            // Aumentar escala para mejor resolución
            const escala = 4.5;
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

            const resultadoRoi = await this.procesarVariantesCodigo(roiCanvas, roi.nombre);

            roiCanvas.width = 0;
            roiCanvas.height = 0;

            if (resultadoRoi.codigo && esCodigoValido(resultadoRoi.codigo)) {
                const confianza = resultadoRoi.confianza || 0;
                if (confianza > 30 || roi.nombre === 'principal') {
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
                if (confianza > mejorConfianza) {
                    mejorConfianza = confianza;
                    mejorResultado = resultadoRoi;
                    metodoUsado = roi.nombre;
                }
            }
        }

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

    // ============================================================
    // PROCESAR VARIANTES DE UN ROI
    // ============================================================
    async procesarVariantesCodigo(roiCanvas, roiNombre) {
        const resultados = [];
        const workerCode = await this.getOcrCodeWorker();

        // Variante 1: Contraste muy alto + binarización (para letras gruesas)
        const v1 = document.createElement('canvas');
        v1.width = roiCanvas.width;
        v1.height = roiCanvas.height;
        const ctx1 = v1.getContext('2d');
        ctx1.drawImage(roiCanvas, 0, 0);
        const imgData1 = ctx1.getImageData(0, 0, v1.width, v1.height);
        const d1 = imgData1.data;
        for (let i = 0; i < d1.length; i += 4) {
            const gray = 0.299 * d1[i] + 0.587 * d1[i + 1] + 0.114 * d1[i + 2];
            let val = (gray - 128) * 2.5 + 128;
            val = Math.max(0, Math.min(255, val));
            d1[i] = d1[i + 1] = d1[i + 2] = val > 100 ? 255 : 0;
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

        // Variante 2: Binarización con umbral 130
        const v2 = document.createElement('canvas');
        v2.width = roiCanvas.width;
        v2.height = roiCanvas.height;
        const ctx2 = v2.getContext('2d');
        ctx2.drawImage(roiCanvas, 0, 0);
        const imgData2 = ctx2.getImageData(0, 0, v2.width, v2.height);
        const d2 = imgData2.data;
        for (let i = 0; i < d2.length; i += 4) {
            const gray = 0.299 * d2[i] + 0.587 * d2[i + 1] + 0.114 * d2[i + 2];
            d2[i] = d2[i + 1] = d2[i + 2] = gray > 130 ? 255 : 0;
        }
        ctx2.putImageData(imgData2, 0, 0);
        try {
            const result = await workerCode.recognize(v2);
            const texto = result.data.text.trim();
            const confianza = result.data.confidence || 0;
            if (texto) resultados.push({ texto, confianza, variante: 'binarizacion_130' });
            if (this.debug) console.log(`   📊 Variante "binarizacion_130": "${texto}" (conf: ${confianza})`);
        } catch (e) { if (this.debug) console.warn('Error en variante:', e); }
        v2.width = 0;
        v2.height = 0;

        // Variante 3: Binarización con umbral 150
        const v3 = document.createElement('canvas');
        v3.width = roiCanvas.width;
        v3.height = roiCanvas.height;
        const ctx3 = v3.getContext('2d');
        ctx3.drawImage(roiCanvas, 0, 0);
        const imgData3 = ctx3.getImageData(0, 0, v3.width, v3.height);
        const d3 = imgData3.data;
        for (let i = 0; i < d3.length; i += 4) {
            const gray = 0.299 * d3[i] + 0.587 * d3[i + 1] + 0.114 * d3[i + 2];
            d3[i] = d3[i + 1] = d3[i + 2] = gray > 150 ? 255 : 0;
        }
        ctx3.putImageData(imgData3, 0, 0);
        try {
            const result = await workerCode.recognize(v3);
            const texto = result.data.text.trim();
            const confianza = result.data.confidence || 0;
            if (texto) resultados.push({ texto, confianza, variante: 'binarizacion_150' });
            if (this.debug) console.log(`   📊 Variante "binarizacion_150": "${texto}" (conf: ${confianza})`);
        } catch (e) { if (this.debug) console.warn('Error en variante:', e); }
        v3.width = 0;
        v3.height = 0;

        // Variante 4: Solo grises + contraste (sin binarización)
        const v4 = document.createElement('canvas');
        v4.width = roiCanvas.width;
        v4.height = roiCanvas.height;
        const ctx4 = v4.getContext('2d');
        ctx4.drawImage(roiCanvas, 0, 0);
        const imgData4 = ctx4.getImageData(0, 0, v4.width, v4.height);
        const d4 = imgData4.data;
        for (let i = 0; i < d4.length; i += 4) {
            let gray = 0.299 * d4[i] + 0.587 * d4[i + 1] + 0.114 * d4[i + 2];
            gray = (gray - 128) * 2.0 + 128;
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

        // Variante 5: Escala 2x (más grande)
        const v5 = document.createElement('canvas');
        v5.width = roiCanvas.width * 1.5;
        v5.height = roiCanvas.height * 1.5;
        const ctx5 = v5.getContext('2d');
        ctx5.imageSmoothingEnabled = true;
        ctx5.imageSmoothingQuality = 'high';
        ctx5.drawImage(roiCanvas, 0, 0, v5.width, v5.height);
        const imgData5 = ctx5.getImageData(0, 0, v5.width, v5.height);
        const d5 = imgData5.data;
        for (let i = 0; i < d5.length; i += 4) {
            let gray = 0.299 * d5[i] + 0.587 * d5[i + 1] + 0.114 * d5[i + 2];
            gray = (gray - 128) * 2.0 + 128;
            gray = Math.max(0, Math.min(255, gray));
            d5[i] = d5[i + 1] = d5[i + 2] = gray > 140 ? 255 : 0;
        }
        ctx5.putImageData(imgData5, 0, 0);
        try {
            const result = await workerCode.recognize(v5);
            const texto = result.data.text.trim();
            const confianza = result.data.confidence || 0;
            if (texto) resultados.push({ texto, confianza, variante: 'escala_2x' });
            if (this.debug) console.log(`   📊 Variante "escala_2x": "${texto}" (conf: ${confianza})`);
        } catch (e) { if (this.debug) console.warn('Error en variante:', e); }
        v5.width = 0;
        v5.height = 0;

        // ============================================================
        // SELECCIONAR EL MEJOR RESULTADO
        // ============================================================
        if (resultados.length === 0) {
            return { codigo: null, confianza: 0, frecuencia: 0 };
        }

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

    extraerCodigoDeTexto(texto) {
        if (!texto) return null;
        const m = texto.match(/([A-Z])\s*(\d{1,4})/i);
        if (m) {
            const cand = normalizeCodigo(m[1] + m[2]);
            if (esCodigoValido(cand)) return cand;
        }
        const limpio = texto.replace(/[^A-Z0-9]/gi, '').toUpperCase();
        const m2 = limpio.match(/([A-Z])(\d{1,4})/);
        if (m2) {
            const cand = normalizeCodigo(m2[1] + m2[2]);
            if (esCodigoValido(cand)) return cand;
        }
        return null;
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
            const scale = Math.min(1.8, 1600 / vW) || 1;
            canvas.width = Math.round(vW * scale);
            canvas.height = Math.round(vH * scale);
            const ctx = canvas.getContext('2d');
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

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
                    _raw: resultado.textoGeneral
                });
            }

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

    // ============================================================
    // SUBIR FOTO
    // ============================================================
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