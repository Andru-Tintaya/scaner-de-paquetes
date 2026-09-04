/**
 * SCANNER - Gestión de cámara, OCR y QR
 *
 * ============================================================
 * CORRECCIONES APLICADAS (esto era lo que rompía el escáner):
 *
 * 1) worker.recognize(imagen, 'spa+eng', {tessedit_pageseg_mode:...})
 *    NO es válido en Tesseract.js v5. La firma real es
 *    worker.recognize(imagen, options) donde "options" es un OBJETO
 *    (p.ej. {rectangle:...}), nunca un string de idioma. Al pasar el
 *    string 'spa+eng' como si fuera ese objeto, cada llamada a
 *    recognize() lanzaba una excepción y por eso "ya no escaneaba nada".
 *    Arreglo: worker.recognize(canvas) a secas, usando el worker que
 *    ya se creó con el idioma correcto (spa) en createWorker.
 *
 * 2) El preprocesamiento aplicaba una binarización dura (blanco/negro
 *    puro con un único umbral fijo). Eso destruye el detalle del texto
 *    pequeño del ticket cuando la iluminación no es perfectamente
 *    uniforme. Arreglo: solo escala de grises + aumento de contraste
 *    moderado (sin binarizar), que es lo que de verdad ayuda a
 *    Tesseract con texto mixto (letras gigantes + letras pequeñas).
 *
 * 3) La imagen se reducía a un máximo de 800px de ancho, empeorando la
 *    lectura de la letra pequeña. Arreglo: se sube la resolución
 *    objetivo y se permite ampliar (no solo reducir) cuando la cámara
 *    entrega un frame pequeño.
 * ============================================================
 */

const Scanner = {
    stream: null,
    currentDeviceId: null,
    availableCameras: [],
    ocrWorker: null,
    qrScanner: null,
    scanMode: 'registro',
    scanType: 'ocr',
    onResultCallback: null,
    isProcessing: false,

    init(onResult) {
        this.onResultCallback = onResult || function () {};
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
    },

    setStatus(msg, show) {
        const el = document.getElementById('camStatus');
        el.textContent = msg;
        el.classList.toggle('show', !!show);
    },

    async getOcrWorker() {
        if (!this.ocrWorker) {
            this.setStatus('⏳ Cargando motor OCR (primera vez)...', true);
            this.ocrWorker = await Tesseract.createWorker('spa');
        }
        return this.ocrWorker;
    },

    /**
     * Prepara el frame para OCR: escala de grises + contraste moderado.
     * SIN binarización dura: eso es lo que rompía la lectura del texto
     * pequeño del ticket. Además, si la imagen de origen es más chica
     * que el ancho objetivo, la AMPLIA en vez de reducirla, porque un
     * texto pequeño escaneado en baja resolución es ilegible para
     * Tesseract.
     */
    prepararCanvas(source, srcWidth, srcHeight) {
        const canvas = document.getElementById('ocrCanvas');
        const targetWidth = 1400; // suficiente para leer letra chica y el código gigante a la vez
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
        const contrast = 1.25; // moderado: mejora legibilidad sin borrar detalle fino
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
    // 📸 CAPTURAR Y ESCANEAR (FUNCIÓN PRINCIPAL) — CORREGIDA
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
            const canvas = this.prepararCanvas(video, video.videoWidth, video.videoHeight);

            this.setStatus('🔎 Leyendo ticket...', true);

            const worker = await this.getOcrWorker();
            // CORREGIDO: antes se llamaba worker.recognize(dataURL, 'spa+eng', {...}),
            // lo cual no es válido y hacía fallar el reconocimiento siempre.
            // Se le pasa el canvas directamente (más rápido y sin pérdida por
            // re-codificar a JPEG), sin un segundo argumento inválido.
            const { data } = await worker.recognize(canvas);

            const texto = data.text || '';
            console.log('📝 OCR DETECTADO:', texto);

            const parsed = Parser.parseTicketData(texto);
            console.log('📦 DATOS EXTRAIDOS:', parsed);

            this.setStatus('✅ Escaneo completado', true);

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

        } catch (e) {
            console.error('Error en captura:', e);
            this.setStatus('⚠️ Error al escanear. Usa el formulario manual.', true);
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

    async handleFileUpload(file) {
        if (!file) return;
        if (this.scanType !== 'ocr') { toast('Cambia a modo OCR', 'error'); return; }
        this.setStatus('🔎 Procesando imagen...', true);

        try {
            const img = await createImageBitmap(file);
            const canvas = this.prepararCanvas(img, img.width, img.height);

            const worker = await this.getOcrWorker();
            // Mismo arreglo que en capturarYEscanear(): sin segundo argumento inválido.
            const { data } = await worker.recognize(canvas);

            const parsed = Parser.parseTicketData(data.text || '');
            this.setStatus('', false);

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