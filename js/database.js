/**
 * BASE DE DATOS - CRUD completo con localStorage
 */

const DB = {
    KEYS: {
        PAQ: 'ml_paquetes',
        CFG: 'ml_config',
        MOV: 'ml_movimientos',
        SEQ: 'ml_seq',
        CLIENTES: 'ml_clientes'
    },

    // -------- Lectura/Escritura --------
    read(key, fallback) {
        try {
            const v = localStorage.getItem(key);
            return v ? JSON.parse(v) : fallback;
        } catch (e) {
            return fallback;
        }
    },

    write(key, val) {
        localStorage.setItem(key, JSON.stringify(val));
    },

    // -------- ID --------
    nextId() {
        let seq = this.read(this.KEYS.SEQ, 0) + 1;
        this.write(this.KEYS.SEQ, seq);
        return seq;
    },

    // -------- Paquetes (CRUD) --------
    getPaquetes() {
        return this.read(this.KEYS.PAQ, []);
    },

    savePaquetes(arr) {
        this.write(this.KEYS.PAQ, arr);
    },

    getPaquete(id) {
        return this.getPaquetes().find(p => p.id === id) || null;
    },

    getPaquetesByEstado(estado) {
        if (!estado || estado === 'todos') return this.getPaquetes();
        return this.getPaquetes().filter(p => p.estado === estado);
    },

    buscarPaquetes(query) {
        const q = query.toLowerCase().trim();
        if (!q) return this.getPaquetes();
        return this.getPaquetes().filter(p =>
            p.codigo.toLowerCase().includes(q) ||
            p.cliente_nombre.toLowerCase().includes(q) ||
            (p.cliente_celular || '').includes(q)
        );
    },

    crearPaquete(datos) {
        const paquetes = this.getPaquetes();
        const cfg = Config.getConfig();

        // Verificar pendiente con mismo código
        const existe = paquetes.find(p =>
            p.codigo === datos.codigo.toUpperCase() &&
            p.estado === 'pendiente'
        );

        if (existe) {
            return { success: false, error: 'Ya existe un paquete pendiente con este código', paquete: existe };
        }

        const nuevo = {
            id: this.nextId(),
            codigo: datos.codigo.toUpperCase(),
            cliente_nombre: datos.cliente_nombre,
            cliente_celular: datos.cliente_celular || null,
            detalle: datos.detalle || null,
            quien_dejo: datos.quien_dejo || null,
            fecha_ticket: datos.fecha_ticket || null,
            fecha_ingreso: new Date().toISOString(),
            fecha_entrega: null,
            precio_base: cfg.precio_base,
            deuda_final: null,
            monto_pagado: null,
            estado: 'pendiente',
            tienda: datos.tienda || 'MEDIA LUNA',
            qr_token: 'PKG-' + Math.random().toString(36).slice(2, 10).toUpperCase()
        };

        paquetes.push(nuevo);
        this.savePaquetes(paquetes);
        this.logMovimiento(nuevo.id, 'REGISTRO', 'Registrado');

        // Actualizar cliente
        this.actualizarCliente(nuevo.cliente_nombre, nuevo.cliente_celular);

        return { success: true, paquete: nuevo };
    },

    actualizarPaquete(id, datos) {
        const paquetes = this.getPaquetes();
        const p = paquetes.find(x => x.id === id);
        if (!p) return { success: false, error: 'Paquete no encontrado' };

        // Verificar código duplicado
        if (datos.codigo && datos.codigo !== p.codigo) {
            const existe = paquetes.find(x =>
                x.codigo === datos.codigo.toUpperCase() &&
                x.estado === 'pendiente' &&
                x.id !== id
            );
            if (existe) {
                return { success: false, error: 'Ya existe otro paquete pendiente con este código' };
            }
            p.codigo = datos.codigo.toUpperCase();
        }

        if (datos.cliente_nombre) p.cliente_nombre = datos.cliente_nombre;
        if (datos.cliente_celular !== undefined) p.cliente_celular = datos.cliente_celular || null;
        if (datos.detalle !== undefined) p.detalle = datos.detalle || null;
        if (datos.quien_dejo !== undefined) p.quien_dejo = datos.quien_dejo || null;
        if (datos.fecha_ticket !== undefined) p.fecha_ticket = datos.fecha_ticket || null;
        if (datos.tienda !== undefined) p.tienda = datos.tienda || 'MEDIA LUNA';

        p.updated_at = new Date().toISOString();
        this.savePaquetes(paquetes);
        this.logMovimiento(id, 'EDICION', 'Datos actualizados');

        // Actualizar cliente
        if (datos.cliente_nombre) {
            this.actualizarCliente(p.cliente_nombre, p.cliente_celular);
        }

        return { success: true, paquete: p };
    },

    entregarPaquete(id, montoPagado) {
        const paquetes = this.getPaquetes();
        const p = paquetes.find(x => x.id === id);
        if (!p) return { success: false, error: 'Paquete no encontrado' };
        if (p.estado === 'entregado') return { success: false, error: 'El paquete ya fue entregado' };

        const cfg = Config.getConfig();
        const deuda = Config.calcularDeuda(p, cfg);

        p.estado = 'entregado';
        p.fecha_entrega = new Date().toISOString();
        p.deuda_final = deuda;
        p.monto_pagado = montoPagado || deuda;

        this.savePaquetes(paquetes);
        this.logMovimiento(id, 'ENTREGA', 'Monto pagado: ' + (montoPagado || deuda));
        return { success: true, paquete: p };
    },

    eliminarPaquete(id) {
        let paquetes = this.getPaquetes();
        const p = paquetes.find(x => x.id === id);
        if (!p) return { success: false, error: 'Paquete no encontrado' };

        paquetes = paquetes.filter(x => x.id !== id);
        this.savePaquetes(paquetes);
        this.logMovimiento(id, 'ELIMINACION', 'Paquete eliminado');
        return { success: true };
    },

    // -------- Clientes --------
    getClientes() {
        return this.read(this.KEYS.CLIENTES, []);
    },

    saveClientes(arr) {
        this.write(this.KEYS.CLIENTES, arr);
    },

    actualizarCliente(nombre, celular) {
        if (!nombre) return;
        const clientes = this.getClientes();
        let cliente = clientes.find(c => c.nombre === nombre);
        if (cliente) {
            if (celular) cliente.celular = celular;
            cliente.total_paquetes = (cliente.total_paquetes || 0) + 1;
            cliente.updated_at = new Date().toISOString();
        } else {
            clientes.push({
                id: this.nextId(),
                nombre: nombre,
                celular: celular || null,
                total_paquetes: 1,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            });
        }
        this.saveClientes(clientes);
    },

    // -------- Movimientos (auditoría) --------
    logMovimiento(paquete_id, accion, detalle) {
        const mov = this.read(this.KEYS.MOV, []);
        mov.push({
            id: this.nextId(),
            paquete_id,
            accion,
            fecha: new Date().toISOString(),
            detalle: detalle || ''
        });
        this.write(this.KEYS.MOV, mov);
    },

    getMovimientos(paquete_id) {
        return this.read(this.KEYS.MOV, []).filter(m => m.paquete_id === paquete_id);
    },

    // -------- Limpiar todo --------
    eliminarTodos() {
        const keys = [this.KEYS.PAQ, this.KEYS.CFG, this.KEYS.MOV, this.KEYS.SEQ, this.KEYS.CLIENTES];
        for (const key of keys) {
            localStorage.removeItem(key);
        }
        return { success: true };
    }
};