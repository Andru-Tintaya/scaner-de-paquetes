/**
 * APP - Controlador principal
 */

const App = {
    currentView: 'scanner',
    filter: 'todos',

    init() {
        Scanner.init((resultado) => {
            if (resultado._existing) {
                this.showExistingPackage(resultado.paquete);
            } else {
                UI.mostrarFormularioConDatos(resultado);
            }
        });

        const cfg = Config.getConfig();
        document.getElementById('cfgMoneda').value = cfg.moneda;
        document.getElementById('cfgPrecioBase').value = cfg.precio_base;
        document.getElementById('cfgDiasGratis').value = cfg.dias_gratis;
        document.getElementById('cfgRecargo').value = cfg.recargo_diario;
        document.getElementById('cfgDiasMora').value = cfg.dias_mora || 15;

        this.renderPaquetes();
        this.renderPublicSearch();
        this.updateHeaderStats();
        this.showView('scanner');

        document.getElementById('btnStartCam').onclick = () => Scanner.startCamera();
        document.getElementById('btnStopCam').onclick = () => Scanner.stop();
        document.getElementById('btnSwitchCam').onclick = () => Scanner.switchCamera();
        document.getElementById('btnCapture').onclick = () => Scanner.capturarYEscanear();
        document.getElementById('fileInput').onchange = (e) => {
            if (e.target.files[0]) {
                Scanner.handleFileUpload(e.target.files[0]);
            }
            e.target.value = '';
        };

        console.log('✅ Media Luna iniciado');
    },

    // -------- Navegación --------
    showView(name) {
        document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
        document.getElementById('view-' + name).classList.add('active');

        ['navScanner', 'navPaquetes', 'navConsulta', 'navConfig']
            .forEach(id => document.getElementById(id).classList.remove('active'));

        const map = { scanner: 'navScanner', paquetes: 'navPaquetes', consulta: 'navConsulta', config: 'navConfig' };
        if (map[name]) document.getElementById(map[name]).classList.add('active');

        this.currentView = name;
        if (name !== 'scanner') Scanner.stop();
        if (name === 'paquetes') this.renderPaquetes();
    },

    // -------- Modos Scanner --------
    setScanMode(m) {
        Scanner.setMode(m);
        document.getElementById('scanResultBox').innerHTML = '';
    },

    setScanType(t) {
        Scanner.setType(t);
        document.getElementById('scanResultBox').innerHTML = '';
    },

    startCamera() { Scanner.startCamera(); },
    stopCamera() { Scanner.stop(); },
    switchCamera() { Scanner.switchCamera(); },
    capturarYEscanear() { Scanner.capturarYEscanear(); },

    limpiarResultado() {
        document.getElementById('scanResultBox').innerHTML = '';
    },

    guardarPaqueteDesdeForm() {
        const codigoRaw = document.getElementById('frmCodigo').value.trim();
        const codigo = normalizeCodigo(codigoRaw);
        const nombre = document.getElementById('frmNombre').value.trim();

        if (!codigo || !esCodigoValido(codigo)) {
            toast('❌ Código inválido. Debe ser letra + números (ej: A49, A10)', 'error');
            document.getElementById('frmCodigo').focus();
            document.getElementById('frmCodigo').select();
            return;
        }

        if (!nombre) {
            toast('❌ El nombre es obligatorio', 'error');
            document.getElementById('frmNombre').focus();
            return;
        }

        const existe = DB.getPaquetes().find(p =>
            p.codigo === codigo.toUpperCase() && p.estado === 'pendiente'
        );

        if (existe) {
            toast('⚠️ Ya existe un paquete pendiente con este código', 'error');
            UI.mostrarPaqueteExistente(existe);
            return;
        }

        const result = DB.crearPaquete({
            codigo: codigo,
            cliente_nombre: nombre,
            cliente_celular: document.getElementById('frmCelular').value.trim() || null,
            detalle: document.getElementById('frmDetalle').value.trim() || null,
            quien_dejo: document.getElementById('frmQuienDejo').value.trim() || null,
            fecha_ticket: document.getElementById('frmFechaTicket')?.value.trim() || null,
            tienda: document.getElementById('frmTienda')?.value || 'MEDIA LUNA'
        });

        if (result.success) {
            toast('✅ Paquete registrado correctamente', 'success');
            document.getElementById('scanResultBox').innerHTML = `
                <div class="panel success">
                    ✅ Paquete <b>${codigo.toUpperCase()}</b> registrado para <b>${nombre}</b>.
                    <br><br>
                    <button class="btn btn-outline btn-sm" onclick="App.limpiarResultado()">📷 Escanear otro</button>
                    <button class="btn btn-primary btn-sm" onclick="App.showView('paquetes')">📦 Ver paquetes</button>
                </div>
            `;
            this.renderPaquetes();
            this.updateHeaderStats();
        } else {
            toast('❌ ' + result.error, 'error');
            if (result.paquete) UI.mostrarPaqueteExistente(result.paquete);
        }
    },

    showExistingPackage(pkg) {
        UI.mostrarPaqueteExistente(pkg);
    },

    // -------- Registro manual --------
    openManualForm() {
        const html = `
            <h3>📦 Registrar paquete manualmente</h3>
            <div class="field">
                <label>🔤 Código</label>
                <input id="mCodigo" placeholder="Ej: A6, A49" style="font-size:24px;font-weight:bold;text-align:center;">
            </div>
            <div class="field"><label>👤 Nombre del cliente</label><input id="mNombre"></div>
            <div class="row2">
                <div class="field"><label>📱 Celular</label><input id="mCelular"></div>
                <div class="field"><label>📦 Detalle</label><input id="mDetalle"></div>
            </div>
            <div class="field"><label>📅 Fecha del ticket</label><input id="mFechaTicket" placeholder="DD/MM/YYYY HH:MM"></div>
            <div class="field"><label>👤 Quién dejó</label><input id="mQuienDejo" placeholder="Opcional"></div>
            <div class="btn-row">
                <button class="btn btn-outline" onclick="UI.closeModal()">Cancelar</button>
                <button class="btn btn-primary" onclick="App.guardarManual()">💾 Guardar</button>
            </div>`;
        UI.openModal(html);
    },

    guardarManual() {
        const codigo = normalizeCodigo(document.getElementById('mCodigo').value);
        const nombre = document.getElementById('mNombre').value.trim();
        if (!esCodigoValido(codigo)) { toast('Código inválido. Ej: A6, A49', 'error'); return; }
        if (!nombre) { toast('El nombre es obligatorio', 'error'); return; }

        const result = DB.crearPaquete({
            codigo: codigo,
            cliente_nombre: nombre,
            cliente_celular: document.getElementById('mCelular').value.trim() || null,
            detalle: document.getElementById('mDetalle').value.trim() || null,
            quien_dejo: document.getElementById('mQuienDejo').value.trim() || null,
            fecha_ticket: document.getElementById('mFechaTicket').value.trim() || null
        });

        UI.closeModal();
        if (result.success) {
            toast('✅ Paquete registrado', 'success');
            this.renderPaquetes();
            this.updateHeaderStats();
        } else {
            toast('❌ ' + result.error, 'error');
            if (result.paquete) UI.mostrarPaqueteExistente(result.paquete);
        }
    },

    // -------- Lista de paquetes --------
    setFilter(f) {
        this.filter = f;
        document.querySelectorAll('.chip').forEach(c => c.classList.toggle('active', c.dataset.f === f));
        this.renderPaquetes();
    },

    renderPaquetes() {
        const q = (document.getElementById('searchBox')?.value || '').trim().toLowerCase();
        let paquetes = q ? DB.buscarPaquetes(q) : DB.getPaquetes();

        if (this.filter !== 'todos') {
            if (this.filter === 'vencido') {
                const cfg = Config.getConfig();
                paquetes = paquetes.filter(p =>
                    p.estado === 'pendiente' && Config.getEstadoMora(p, cfg) === 'vencido'
                );
            } else {
                paquetes = paquetes.filter(p => p.estado === this.filter);
            }
        }

        paquetes.sort((a, b) => b.fecha_ingreso.localeCompare(a.fecha_ingreso));
        UI.renderStats(DB.getPaquetes());

        const list = document.getElementById('pkgList');
        if (paquetes.length === 0) {
            list.innerHTML = '<div class="empty-state">📭 No hay paquetes que coincidan.</div>';
            return;
        }

        list.innerHTML = paquetes.map(p => UI.renderPkgCard(p, false)).join('');

        list.querySelectorAll('[data-action]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const action = btn.dataset.action;
                const id = parseInt(btn.dataset.id);
                switch (action) {
                    case 'editar': this.openEditForm(id); break;
                    case 'entregar': this.confirmarEntrega(id); break;
                    case 'eliminar': this.eliminarPaquete(id); break;
                    case 'whatsapp': this.enviarWhatsapp(id); break;
                    case 'qr': this.verQr(id); break;
                }
            });
        });
    },

    renderPublicSearch() {
        const q = (document.getElementById('publicSearchBox')?.value || '').trim().toLowerCase();
        const box = document.getElementById('publicResultList');
        if (!q) {
            box.innerHTML = '<div class="empty-state">🔍 Escribe un código o nombre para buscar tu paquete.</div>';
            return;
        }
        const paquetes = DB.buscarPaquetes(q);
        if (paquetes.length === 0) {
            box.innerHTML = '<div class="empty-state">📭 No se encontraron paquetes.</div>';
            return;
        }
        box.innerHTML = paquetes.map(p => UI.renderPkgCard(p, true)).join('');
    },

    // -------- Editar --------
    openEditForm(id) {
        const p = DB.getPaquete(id);
        if (!p) return;
        const html = `
            <h3>✏️ Editar paquete ${p.codigo}</h3>
            <div class="field">
                <label>🔤 Código</label>
                <input id="eCodigo" value="${p.codigo}" style="font-size:24px;font-weight:bold;text-align:center;">
            </div>
            <div class="field"><label>👤 Nombre</label><input id="eNombre" value="${p.cliente_nombre}"></div>
            <div class="row2">
                <div class="field"><label>📱 Celular</label><input id="eCelular" value="${p.cliente_celular||''}"></div>
                <div class="field"><label>📦 Detalle</label><input id="eDetalle" value="${p.detalle||''}"></div>
            </div>
            <div class="field"><label>📅 Fecha del ticket</label><input id="eFechaTicket" value="${p.fecha_ticket||''}"></div>
            <div class="field"><label>👤 Quién dejó</label><input id="eQuienDejo" value="${p.quien_dejo||''}"></div>
            <div class="btn-row">
                <button class="btn btn-outline" onclick="UI.closeModal()">Cancelar</button>
                <button class="btn btn-primary" onclick="App.guardarEdicion(${p.id})">💾 Guardar</button>
            </div>`;
        UI.openModal(html);
    },

    guardarEdicion(id) {
        const result = DB.actualizarPaquete(id, {
            codigo: document.getElementById('eCodigo').value.trim(),
            cliente_nombre: document.getElementById('eNombre').value.trim(),
            cliente_celular: document.getElementById('eCelular').value.trim(),
            detalle: document.getElementById('eDetalle').value.trim(),
            quien_dejo: document.getElementById('eQuienDejo').value.trim(),
            fecha_ticket: document.getElementById('eFechaTicket').value.trim()
        });

        UI.closeModal();
        if (result.success) {
            toast('✅ Paquete actualizado', 'success');
            this.renderPaquetes();
            this.updateHeaderStats();
        } else {
            toast('❌ ' + result.error, 'error');
        }
    },

    // -------- Entrega --------
    confirmarEntrega(id) {
        const p = DB.getPaquete(id);
        if (!p || p.estado !== 'pendiente') return;
        const cfg = Config.getConfig();
        const deuda = Config.calcularDeuda(p, cfg);

        const html = `
            <h3>✅ Confirmar entrega</h3>
            <p class="hint">Código: <b style="color:var(--text)">${p.codigo}</b><br>
            Cliente: <b style="color:var(--text)">${p.cliente_nombre}</b><br>
            Deuda: <b style="color:var(--accent)">${fmtMoney(deuda,cfg)}</b></p>
            <div class="field"><label>Monto pagado</label>
            <input id="montoPagado" type="number" step="0.5" value="${deuda}"></div>
            <div class="btn-row">
                <button class="btn btn-outline" onclick="UI.closeModal()">Cancelar</button>
                <button class="btn btn-success" onclick="App.entregarPaquete(${p.id})">✅ Confirmar</button>
            </div>`;
        UI.openModal(html);
    },

    entregarPaquete(id) {
        const monto = parseFloat(document.getElementById('montoPagado').value) || 0;
        const result = DB.entregarPaquete(id, monto);
        UI.closeModal();
        if (result.success) {
            toast('✅ Paquete entregado', 'success');
            this.renderPaquetes();
            this.updateHeaderStats();
        } else {
            toast('❌ ' + result.error, 'error');
        }
    },

    // -------- Eliminar --------
    eliminarPaquete(id) {
        const p = DB.getPaquete(id);
        if (!p) return;
        const html = `
            <h3>🗑️ Eliminar paquete</h3>
            <p class="hint">¿Eliminar <b style="color:var(--text)">${p.codigo} — ${p.cliente_nombre}</b>? Esta acción no se puede deshacer.</p>
            <div class="btn-row">
                <button class="btn btn-outline" onclick="UI.closeModal()">Cancelar</button>
                <button class="btn btn-danger" onclick="App.confirmarEliminar(${p.id})">🗑️ Eliminar</button>
            </div>`;
        UI.openModal(html);
    },

    confirmarEliminar(id) {
        const result = DB.eliminarPaquete(id);
        UI.closeModal();
        if (result.success) {
            toast('Paquete eliminado');
            this.renderPaquetes();
            this.updateHeaderStats();
        } else {
            toast('❌ ' + result.error, 'error');
        }
    },

    // -------- WhatsApp --------
    enviarWhatsapp(id) {
        const p = DB.getPaquete(id);
        if (!p || !p.cliente_celular) return;
        const cfg = Config.getConfig();
        const deuda = Config.calcularDeuda(p, cfg);
        const primerNombre = p.cliente_nombre.split(' ')[0];
        let numero = p.cliente_celular.replace(/\D/g, '');
        if (numero.length === 8) numero = '591' + numero;

        const mensaje = p.estado === 'pendiente' ?
            `Hola ${primerNombre} 👋\n\n📦 Tienes un paquete pendiente en MEDIA LUNA.\nCódigo: ${p.codigo}\n💰 Deuda: ${fmtMoney(deuda,cfg)}\n${p.fecha_ticket ? '🎫 Fecha ticket: '+p.fecha_ticket : ''}\n\n📍 Te esperamos.` :
            `Hola ${primerNombre} 👋\n\n✅ Tu paquete (${p.codigo}) ya fue entregado. ¡Gracias por confiar en MEDIA LUNA!`;

        window.open('https://wa.me/' + numero + '?text=' + encodeURIComponent(mensaje), '_blank');
    },

    // -------- QR --------
    verQr(id) {
        const p = DB.getPaquete(id);
        if (!p) return;
        const html = `
            <h3>📱 QR del paquete ${p.codigo}</h3>
            <p class="hint">Token único para este paquete.</p>
            <div class="panel quiet" style="text-align:center;word-break:break-all;font-family:monospace;color:var(--accent);padding:12px;">${p.qr_token}</div>
            <button class="btn btn-outline" onclick="UI.closeModal()">Cerrar</button>`;
        UI.openModal(html);
    },

    // -------- Configuración --------
    saveConfig() {
        const cfg = {
            moneda: document.getElementById('cfgMoneda').value.trim() || 'Bs',
            precio_base: parseFloat(document.getElementById('cfgPrecioBase').value) || 0,
            dias_gratis: parseInt(document.getElementById('cfgDiasGratis').value) || 0,
            recargo_diario: parseFloat(document.getElementById('cfgRecargo').value) || 0,
            dias_mora: parseInt(document.getElementById('cfgDiasMora').value) || 15
        };
        Config.saveConfig(cfg);
        toast('✅ Configuración guardada', 'success');
        this.renderPaquetes();
        this.updateHeaderStats();
    },

    // -------- Eliminar todos --------
    eliminarTodosLosDatos() {
        const html = `
            <h3>⚠️ ELIMINAR TODOS LOS DATOS</h3>
            <p class="hint" style="color:var(--danger);font-weight:600;">Esta acción eliminará TODOS los paquetes y configuraciones.</p>
            <div class="btn-row">
                <button class="btn btn-outline" onclick="UI.closeModal()">Cancelar</button>
                <button class="btn btn-danger" onclick="App.confirmarEliminarTodo()">🗑️ Eliminar todo</button>
            </div>`;
        UI.openModal(html);
    },

    confirmarEliminarTodo() {
        DB.eliminarTodos();
        UI.closeModal();
        toast('🗑️ Todos los datos eliminados');
        const cfg = Config.getConfig();
        document.getElementById('cfgMoneda').value = cfg.moneda;
        document.getElementById('cfgPrecioBase').value = cfg.precio_base;
        document.getElementById('cfgDiasGratis').value = cfg.dias_gratis;
        document.getElementById('cfgRecargo').value = cfg.recargo_diario;
        document.getElementById('cfgDiasMora').value = cfg.dias_mora || 15;
        this.renderPaquetes();
        this.updateHeaderStats();
        document.getElementById('scanResultBox').innerHTML = '';
    },

    updateHeaderStats() {
        const pend = DB.getPaquetes().filter(p => p.estado === 'pendiente').length;
        document.getElementById('headerStats').innerHTML = `<b>${pend}</b> pendientes`;
    }
};

document.addEventListener('DOMContentLoaded', () => App.init());