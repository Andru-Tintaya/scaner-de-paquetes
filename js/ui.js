/**
 * UI - Renderizado de interfaz, modales, toasts, tarjetas
 * VERSIÓN FINAL - Con métricas de confianza del OCR y corrección de botones
 */

const UI = {
    // ============================================================
    // MODAL
    // ============================================================
    openModal(innerHtml) {
        this.closeModal();
        const backdrop = document.createElement('div');
        backdrop.className = 'modal-backdrop';
        backdrop.id = 'activeModal';
        backdrop.onclick = (e) => {
            if (e.target === backdrop) this.closeModal();
        };
        const sheet = document.createElement('div');
        sheet.className = 'modal-sheet';
        sheet.innerHTML = innerHtml;
        backdrop.appendChild(sheet);
        document.body.appendChild(backdrop);
    },

    closeModal() {
        const m = document.getElementById('activeModal');
        if (m) m.remove();
    },

    // ============================================================
    // TOAST
    // ============================================================
    toast(msg, type) {
        const t = document.createElement('div');
        t.className = 'toast';
        if (type === 'error') t.style.borderColor = '#dc3545';
        if (type === 'success') t.style.borderColor = '#28a745';
        t.textContent = msg;
        document.body.appendChild(t);
        setTimeout(() => t.remove(), 2800);
    },

    // ============================================================
    // TARJETA DE PAQUETE
    // ============================================================
    renderPkgCard(p, readOnly) {
        const cfg = Config.getConfig();
        const dias = daysBetween(p.fecha_ingreso);
        const deuda = p.estado === 'entregado' ? p.deuda_final : Config.calcularDeuda(p, cfg);
        const estadoMora = Config.getEstadoMora(p, cfg);

        let diasBadge = '';
        if (p.estado === 'pendiente') {
            if (estadoMora === 'vencido') {
                diasBadge = '<span class="badge alerta">⏰ ' + dias + ' días 🔴</span>';
            } else if (estadoMora === 'alerta') {
                diasBadge = '<span class="badge" style="background:#fff3cd;color:#856404;">⏰ ' + dias + ' días ⚠️</span>';
            } else {
                diasBadge = '<span class="badge" style="background:var(--surface-2);color:var(--muted)">' + dias + ' días</span>';
            }
        }

        const badgeClass = p.estado === 'pendiente' ?
            (estadoMora === 'vencido' ? 'alerta' : 'pendiente') :
            'entregado';

        const badgeText = p.estado === 'pendiente' ?
            (estadoMora === 'vencido' ? '🔴 VENCIDO' : '⏳ Pendiente') :
            '✅ Entregado';

        const actions = readOnly ? '' : `
            <div class="pkg-actions">
                ${p.estado === 'pendiente' ? '<button class="entregar" data-action="entregar" data-id="' + p.id + '">✅ Entregar</button>' : ''}
                <button data-action="editar" data-id="${p.id}">✏️ Editar</button>
                ${p.cliente_celular ? '<button class="wa" data-action="whatsapp" data-id="' + p.id + '">💬 WhatsApp</button>' : ''}
                <button data-action="qr" data-id="${p.id}">📱 QR</button>
                <button class="eliminar" data-action="eliminar" data-id="${p.id}">🗑️ Eliminar</button>
            </div>`;

        return `
            <div class="pkg-card" data-id="${p.id}">
                <div class="pkg-top">
                    <div>
                        <span class="pkg-code">${p.codigo}</span>
                        <div class="pkg-name">${p.cliente_nombre}</div>
                    </div>
                    <span class="badge ${badgeClass}">${badgeText}</span>
                </div>
                <div class="pkg-meta">
                    ${p.detalle ? '📦 ' + p.detalle + ' · ' : ''}
                    📅 ${fmtDate(p.fecha_ingreso)} ${diasBadge}<br>
                    💰 <b style="color:var(--accent)">${fmtMoney(deuda, cfg)}</b>
                    ${p.cliente_celular ? ' · 📱 ' + p.cliente_celular : ''}
                    ${p.fecha_ticket ? ' · 🎫 ' + p.fecha_ticket : ''}
                    ${p.quien_dejo ? ' · 👤 ' + p.quien_dejo : ''}
                </div>
                ${actions}
            </div>`;
    },

    // ============================================================
    // ESTADÍSTICAS
    // ============================================================
    renderStats(paquetes) {
        const cfg = Config.getConfig();
        const total = paquetes.length;
        const pend = paquetes.filter(p => p.estado === 'pendiente').length;
        const deudaTotal = paquetes.filter(p => p.estado === 'pendiente')
            .reduce((s, p) => s + Config.calcularDeuda(p, cfg), 0);
        const vencidos = paquetes.filter(p =>
            p.estado === 'pendiente' && Config.getEstadoMora(p, cfg) === 'vencido'
        ).length;

        document.getElementById('statRow').innerHTML = `
            <div class="stat"><b>${total}</b><span>Total</span></div>
            <div class="stat"><b>${pend}</b><span>Pendientes</span></div>
            <div class="stat"><b>${fmtMoney(deudaTotal, cfg)}</b><span>Deuda total</span></div>
            <div class="stat" style="border-left:3px solid var(--danger);"><b style="color:var(--danger);">${vencidos}</b><span>Vencidos</span></div>
        `;
    },

    // ============================================================
    // MOSTRAR FORMULARIO CON DATOS DETECTADOS
    // ============================================================
    mostrarFormularioConDatos(parsed) {
        const box = document.getElementById('scanResultBox');

        // Verificar si ya existe un paquete pendiente con este código
        let paqueteExistente = null;
        if (parsed.codigo && esCodigoValido(parsed.codigo)) {
            paqueteExistente = DB.getPaquetes().find(p =>
                p.codigo === parsed.codigo.toUpperCase() && p.estado === 'pendiente'
            );
        }

        if (paqueteExistente) {
            this.mostrarPaqueteExistente(paqueteExistente);
            return;
        }

        const fechaDisplay = parsed.fecha_ticket ?
            `<div class="field"><label>📅 Fecha del ticket</label><input id="frmFechaTicket" value="${parsed.fecha_ticket}" style="background:var(--surface-2);"></div>` :
            '';

        const advertenciaCodigo = (!parsed.codigo || !esCodigoValido(parsed.codigo)) ?
            `<p class="hint" style="color:var(--warn);font-weight:bold;font-size:14px;">
                ⚠️ El código gigante no se detectó correctamente. Escríbelo manualmente abajo.
            </p>` :
            '';

        // Mostrar métricas del OCR especializado (si existen)
        let infoConfianza = '';
        if (parsed._codigo_confianza) {
            const confianza = Math.round(parsed._codigo_confianza * 100);
            const metodo = parsed._codigo_metodo || 'desconocido';
            const frecuencia = parsed._codigo_frecuencia || 1;
            const icono = confianza > 80 ? '✅' : confianza > 50 ? '⚠️' : '❌';
            infoConfianza = `
                <p class="hint" style="font-size:11px;color:var(--muted);border-top:1px solid var(--border);padding-top:8px;margin-top:8px;">
                    ${icono} OCR código: confianza ${confianza}% · ${frecuencia} variante(s) · método: ${metodo}
                </p>
            `;
        }

        box.innerHTML = `
            <div class="panel success scan-result">
                <h3>📦 ${parsed.cliente_nombre ? 'Datos detectados' : 'Registrar paquete'}</h3>
                ${advertenciaCodigo}

                <div class="field" style="border:2px solid var(--accent);border-radius:8px;padding:10px;background:var(--bg);">
                    <label style="font-size:14px;font-weight:bold;color:var(--accent);">
                        🔤 CÓDIGO (EDITA SI ES NECESARIO)
                    </label>
                    <input id="frmCodigo"
                           value="${parsed.codigo || ''}"
                           placeholder="Ej: A49, A10"
                           style="font-size:28px;font-weight:bold;text-align:center;background:white;border:2px solid var(--accent);">
                </div>

                ${infoConfianza}

                <div class="field">
                    <label>👤 Nombre del cliente</label>
                    <input id="frmNombre" value="${parsed.cliente_nombre || ''}" placeholder="Nombre completo">
                </div>

                <div class="row2">
                    <div class="field">
                        <label>📱 Celular</label>
                        <input id="frmCelular" value="${parsed.cliente_celular || ''}" placeholder="71234567">
                    </div>
                    <div class="field">
                        <label>📦 Detalle</label>
                        <input id="frmDetalle" value="${parsed.detalle || ''}" placeholder="ELECTRONICOS">
                    </div>
                </div>

                ${fechaDisplay}

                <div class="field">
                    <label>👤 Quién dejó</label>
                    <input id="frmQuienDejo" placeholder="Opcional">
                </div>

                <input type="hidden" id="frmTienda" value="${parsed.tienda || 'MEDIA LUNA'}">

                <div class="btn-row">
                    <button class="btn btn-outline" onclick="App.limpiarResultado()">🗑️ Cancelar</button>
                    <button class="btn btn-primary" onclick="App.guardarPaqueteDesdeForm()">💾 Guardar paquete</button>
                </div>

                <p class="hint" style="margin-top:10px;font-size:11px;color:var(--muted);">
                    💡 El código es el que está impreso en GRANDE en el ticket (ej: A49, A10).
                    ${(!parsed.codigo || !esCodigoValido(parsed.codigo)) ? '⚠️ Como no se detectó, escríbelo manualmente.' : 'Si es incorrecto, corrígelo.'}
                </p>
            </div>
        `;

        if (!parsed.codigo || !esCodigoValido(parsed.codigo)) {
            setTimeout(() => {
                document.getElementById('frmCodigo')?.focus();
                document.getElementById('frmCodigo')?.select();
            }, 400);
        }
    },

    // ============================================================
    // MOSTRAR PAQUETE EXISTENTE (CORREGIDO)
    // ============================================================
    mostrarPaqueteExistente(pkg) {
        const box = document.getElementById('scanResultBox');
        const cfg = Config.getConfig();
        const deuda = Config.calcularDeuda(pkg, cfg);

        box.innerHTML = `
            <div class="panel warn">
                <b style="color:var(--warn);">⚠️ PAQUETE YA REGISTRADO</b>
                <div style="margin-top:10px;"><span class="code-badge">${pkg.codigo}</span></div>
                <p style="margin:10px 0 2px;font-size:15px;font-weight:600;">${pkg.cliente_nombre}</p>
                <p class="hint" style="margin:2px 0;">Estado: ${pkg.estado} · Ingreso: ${fmtDate(pkg.fecha_ingreso)}</p>
                <p class="hint" style="margin:2px 0 10px;">Deuda: <b style="color:var(--accent)">${fmtMoney(deuda, cfg)}</b></p>
                <div class="btn-row">
                    ${pkg.estado === 'pendiente' ? '<button class="btn btn-success" data-action="entregar" data-id="' + pkg.id + '">✅ Entregar</button>' : ''}
                    <button class="btn btn-outline" data-action="editar" data-id="${pkg.id}">✏️ Editar</button>
                    <button class="btn btn-outline" onclick="App.limpiarResultado()">📷 Escanear otro</button>
                </div>
            </div>`;

        // Delegación de eventos para los botones con data-action de este panel
        box.querySelectorAll('[data-action]').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = parseInt(btn.dataset.id, 10);
                if (btn.dataset.action === 'entregar') {
                    App.confirmarEntrega(id);
                } else if (btn.dataset.action === 'editar') {
                    App.openEditForm(id);
                }
            });
        });
    },

    // ============================================================
    // MOSTRAR RESULTADO DE ESCANEO (legado - mantener compatibilidad)
    // ============================================================
    showScanResult(parsed, modo) {
        // Esta función se mantiene por compatibilidad
        // Pero ahora usamos mostrarFormularioConDatos() como principal
        this.mostrarFormularioConDatos(parsed);
    }
};