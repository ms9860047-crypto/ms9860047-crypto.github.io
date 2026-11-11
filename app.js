function leerDato(clave, valorInicial) {
    try {
        const dato = localStorage.getItem(clave);
        return dato === null ? valorInicial : JSON.parse(dato);
    } catch {
        return valorInicial;
    }
}

function crearId() {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function fechaHoy() {
    const ahora = new Date();
    const diferencia = ahora.getTimezoneOffset() * 60000;
    return new Date(ahora.getTime() - diferencia).toISOString().slice(0, 10);
}

function comoLista(clave) {
    const dato = leerDato(clave, []);
    return Array.isArray(dato) ? dato : [];
}

let inventario = comoLista("inventario").map(item => ({
    ...item,
    id: item.id || crearId(),
    nombre: String(item.nombre || ""),
    cantidad: Number(item.cantidad) || 0,
    unidad: item.unidad || "unidad",
    precio: Number(item.precio) || 0,
    stockMinimo: Number(item.stockMinimo) || 0
}));

let sabores = comoLista("sabores").map(sabor =>
    typeof sabor === "string" ? sabor : String(sabor.nombre || "")
).filter(Boolean);

let recetas = comoLista("recetas").map(item => ({
    ...item,
    id: item.id || crearId(),
    cantidad: Number(item.cantidad) || 0
}));

let producciones = comoLista("producciones").map(item => ({
    ...item,
    id: item.id || crearId(),
    cantidad: Number(item.cantidad) || 0,
    costoTotal: Number(item.costoTotal) || 0,
    costoUnitario: Number(item.costoUnitario) || 0,
    consumos: Array.isArray(item.consumos) ? item.consumos : []
}));

let ventas = comoLista("ventas").map(item => ({
    ...item,
    id: item.id || crearId(),
    cantidad: Number(item.cantidad) || 0,
    precio: Number(item.precio) || 0,
    ingreso: Number(item.ingreso) || Number(item.cantidad) * Number(item.precio),
    costo: Number(item.costo) || 0,
    ganancia: Number(item.ganancia) || Number(item.ingreso) || 0,
    sabor: item.sabor || "Registro anterior",
    fecha: item.fecha || ""
}));

const gastosGuardados = leerDato("gastos", []);
let gastos = Array.isArray(gastosGuardados)
    ? gastosGuardados.map(item => ({
        ...item,
        id: item.id || crearId(),
        monto: Number(item.monto) || 0
    }))
    : Object.entries(gastosGuardados || {}).map(([nombre, monto]) => ({
        id: crearId(),
        nombre,
        monto: Number(monto) || 0,
        fecha: ""
    })).filter(item => item.monto > 0);

const ediciones = {
    inventario: null,
    recetas: null,
    producciones: null,
    ventas: null,
    gastos: null
};

let clienteNube = null;
let usuarioNube = null;
let datosNubeListos = false;
let canalNube = null;
let ultimaActualizacionNube = null;
let colaEscriturasNube = Promise.resolve();

function estadoActualNube() {
    return { inventario, sabores, recetas, producciones, ventas, gastos };
}

function guardarEnEsteDispositivo() {
    localStorage.setItem("inventario", JSON.stringify(inventario));
    localStorage.setItem("sabores", JSON.stringify(sabores));
    localStorage.setItem("recetas", JSON.stringify(recetas));
    localStorage.setItem("producciones", JSON.stringify(producciones));
    localStorage.setItem("ventas", JSON.stringify(ventas));
    localStorage.setItem("gastos", JSON.stringify(gastos));
}

function guardarDatos() {
    guardarEnEsteDispositivo();
    if (!clienteNube || !usuarioNube) return;

    const usuarioId = usuarioNube.id;
    const estado = estadoActualNube();
    colaEscriturasNube = colaEscriturasNube.catch(() => {}).then(async () => {
        if (!usuarioNube || usuarioNube.id !== usuarioId) return;
        actualizarEstadoNube("Guardando cambios en la nube...");
        const { data, error } = await clienteNube
            .from("app_state")
            .upsert({
                user_id: usuarioId,
                data: estado,
                updated_at: new Date().toISOString()
            })
            .select("updated_at")
            .single();
        if (error) {
            actualizarEstadoNube(`No se pudo sincronizar: ${error.message}`);
            return;
        }
        ultimaActualizacionNube = data.updated_at;
        actualizarEstadoNube("Cambios guardados y sincronizados.");
    });
}

function escapar(texto) {
    return String(texto).replace(/[&<>"']/g, caracter => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    })[caracter]);
}

function dinero(valor) {
    return `S/ ${Number(valor || 0).toFixed(2)}`;
}

function textoFecha(fecha) {
    if (!fecha) return "Sin fecha";
    const [anio, mes, dia] = fecha.split("-");
    return `${dia}/${mes}/${anio}`;
}

function actualizarSelectores() {
    const opcionesSabor = sabores.map(sabor =>
        `<option value="${escapar(sabor)}">${escapar(sabor)}</option>`
    ).join("");
    const opcionesInsumo = inventario.map(item =>
        `<option value="${item.id}">${escapar(item.nombre)} (${escapar(item.unidad)})</option>`
    ).join("");

    ["saborReceta", "saborProduccion", "saborVenta"].forEach(id => {
        const selector = document.getElementById(id);
        const valorActual = selector.value;
        selector.innerHTML = `<option value="">Selecciona sabor</option>${opcionesSabor}`;
        if (sabores.includes(valorActual)) selector.value = valorActual;
    });

    const selectorInsumo = document.getElementById("insumoReceta");
    const insumoActual = selectorInsumo.value;
    selectorInsumo.innerHTML = `<option value="">Selecciona insumo</option>${opcionesInsumo}`;
    if (inventario.some(item => item.id === insumoActual)) selectorInsumo.value = insumoActual;
}

function renderInventario() {
    document.getElementById("tablaInventario").innerHTML = inventario.map(item => `
        <tr>
            <td>${escapar(item.nombre)}</td>
            <td>${item.cantidad.toFixed(2)}</td>
            <td>${escapar(item.unidad)}</td>
            <td>${dinero(item.precio)}</td>
            <td>${item.stockMinimo.toFixed(2)} ${escapar(item.unidad)}</td>
            <td class="actions">
                <button class="small-button" onclick="editarInsumo('${item.id}')">Editar</button>
                <button class="small-button danger-button" onclick="eliminarInsumo('${item.id}')">Eliminar</button>
            </td>
        </tr>
    `).join("");
}

function renderSabores() {
    document.getElementById("listaSabores").innerHTML = sabores.map((sabor, indice) => `
        <li>
            <span>${escapar(sabor)}</span>
            <span class="actions">
                <button class="small-button" onclick="editarSabor(${indice})">Editar</button>
                <button class="small-button danger-button" onclick="eliminarSabor(${indice})">Eliminar</button>
            </span>
        </li>
    `).join("");
}

function renderRecetas() {
    document.getElementById("tablaRecetas").innerHTML = recetas.map(item => {
        const insumo = inventario.find(registro => registro.id === item.inventarioId);
        return `
            <tr>
                <td>${escapar(item.sabor)}</td>
                <td>${escapar(insumo ? insumo.nombre : "Insumo eliminado")}</td>
                <td>${item.cantidad} ${escapar(insumo ? insumo.unidad : "")}</td>
                <td class="actions">
                    <button class="small-button" onclick="editarReceta('${item.id}')">Editar</button>
                    <button class="small-button danger-button" onclick="eliminarReceta('${item.id}')">Eliminar</button>
                </td>
            </tr>
        `;
    }).join("");
}

function unidadesProducidas(sabor, excluirId = null) {
    return producciones
        .filter(item => item.sabor === sabor && item.id !== excluirId)
        .reduce((total, item) => total + item.cantidad, 0);
}

function unidadesVendidas(sabor, excluirId = null) {
    return ventas
        .filter(item => item.sabor === sabor && item.id !== excluirId)
        .reduce((total, item) => total + item.cantidad, 0);
}

function renderStockProductos() {
    document.getElementById("tablaStockProductos").innerHTML = sabores.map(sabor => {
        const producidos = unidadesProducidas(sabor);
        const vendidos = unidadesVendidas(sabor);
        return `
            <tr>
                <td>${escapar(sabor)}</td>
                <td>${producidos}</td>
                <td>${vendidos}</td>
                <td>${producidos - vendidos}</td>
            </tr>
        `;
    }).join("");
}

function renderProducciones() {
    document.getElementById("tablaProduccion").innerHTML = producciones.map(item => `
        <tr>
            <td>${textoFecha(item.fecha)}</td>
            <td>${escapar(item.sabor)}</td>
            <td>${item.cantidad}</td>
            <td>${dinero(item.costoTotal)}</td>
            <td class="actions">
                <button class="small-button" onclick="editarProduccion('${item.id}')">Editar</button>
                <button class="small-button danger-button" onclick="eliminarProduccion('${item.id}')">Eliminar</button>
            </td>
        </tr>
    `).join("");
}

function renderVentas() {
    document.getElementById("tablaVentas").innerHTML = ventas.map(item => `
        <tr>
            <td>${textoFecha(item.fecha)}</td>
            <td>${escapar(item.sabor)}</td>
            <td>${item.cantidad}</td>
            <td>${dinero(item.ingreso)}</td>
            <td>${dinero(item.costo)}</td>
            <td>${dinero(item.ganancia)}</td>
            <td class="actions">
                <button class="small-button" onclick="editarVenta('${item.id}')">Editar</button>
                <button class="small-button danger-button" onclick="eliminarVenta('${item.id}')">Eliminar</button>
            </td>
        </tr>
    `).join("");

    const totalIngresos = ventas.reduce((total, item) => total + item.ingreso, 0);
    document.getElementById("ventasInfo").textContent = `Ventas registradas: ${dinero(totalIngresos)}`;
}

function renderGastos() {
    document.getElementById("tablaGastos").innerHTML = gastos.map(item => `
        <tr>
            <td>${escapar(item.nombre)}</td>
            <td>${textoFecha(item.fecha)}</td>
            <td>${dinero(item.monto)}</td>
            <td class="actions">
                <button class="small-button" onclick="editarGasto('${item.id}')">Editar</button>
                <button class="small-button danger-button" onclick="eliminarGasto('${item.id}')">Eliminar</button>
            </td>
        </tr>
    `).join("");
}

function inicioSemana(fecha) {
    const inicio = new Date(`${fecha}T00:00:00`);
    const dia = (inicio.getDay() + 6) % 7;
    inicio.setDate(inicio.getDate() - dia);
    const diferencia = inicio.getTimezoneOffset() * 60000;
    return new Date(inicio.getTime() - diferencia).toISOString().slice(0, 10);
}

function resumenPeriodo(inicio, fin) {
    const ventasPeriodo = ventas.filter(item => item.fecha >= inicio && item.fecha <= fin);
    const gastosPeriodo = gastos.filter(item => item.fecha >= inicio && item.fecha <= fin);
    const ingresos = ventasPeriodo.reduce((total, item) => total + item.ingreso, 0);
    const costo = ventasPeriodo.reduce((total, item) => total + item.costo, 0);
    const totalGastos = gastosPeriodo.reduce((total, item) => total + item.monto, 0);
    return { ingresos, costo, gastos: totalGastos, ganancia: ingresos - costo - totalGastos };
}

function renderGanancias() {
    const hoy = fechaHoy();
    const inicioMes = `${hoy.slice(0, 7)}-01`;
    const mesSiguiente = new Date(`${inicioMes}T00:00:00`);
    mesSiguiente.setMonth(mesSiguiente.getMonth() + 1);
    mesSiguiente.setDate(0);
    const diferencia = mesSiguiente.getTimezoneOffset() * 60000;
    const finMes = new Date(mesSiguiente.getTime() - diferencia).toISOString().slice(0, 10);
    const periodos = [
        { nombre: "Hoy", inicio: hoy, fin: hoy },
        { nombre: "Esta semana", inicio: inicioSemana(hoy), fin: hoy },
        { nombre: "Este mes", inicio: inicioMes, fin: finMes }
    ];

    document.getElementById("gananciasInfo").innerHTML = periodos.map(periodo => {
        const resumen = resumenPeriodo(periodo.inicio, periodo.fin);
        return `
            <article class="report-item">
                <h3>${periodo.nombre}</h3>
                <p>Ingresos: <strong>${dinero(resumen.ingresos)}</strong></p>
                <p>Costo vendido: <strong>${dinero(resumen.costo)}</strong></p>
                <p>Gastos: <strong>${dinero(resumen.gastos)}</strong></p>
                <p class="net-profit">Ganancia neta: ${dinero(resumen.ganancia)}</p>
            </article>
        `;
    }).join("");
}

function renderDashboard() {
    const hoy = fechaHoy();
    const ventasHoy = ventas.filter(item => item.fecha === hoy);
    const gastosHoy = gastos.filter(item => item.fecha === hoy);
    const ingresos = ventasHoy.reduce((total, item) => total + item.ingreso, 0);
    const costos = ventasHoy.reduce((total, item) => total + item.costo, 0);
    const gastosDelDia = gastosHoy.reduce((total, item) => total + item.monto, 0);
    const stockTerminado = sabores.reduce((total, sabor) =>
        total + unidadesProducidas(sabor) - unidadesVendidas(sabor), 0
    );
    const valorInventario = inventario.reduce((total, item) => total + item.precio, 0);
    const tarjetas = [
        { titulo: "Producto terminado", valor: `${stockTerminado} unidades` },
        { titulo: "Ventas de hoy", valor: dinero(ingresos) },
        { titulo: "Ganancia neta hoy", valor: dinero(ingresos - costos - gastosDelDia) },
        { titulo: "Valor del inventario", valor: dinero(valorInventario) }
    ];
    document.getElementById("dashboardInfo").innerHTML = tarjetas.map(tarjeta => `
        <article class="metric-item">
            <p>${tarjeta.titulo}</p>
            <strong>${tarjeta.valor}</strong>
        </article>
    `).join("");
}

function renderAlertasInventario() {
    const alertas = inventario.filter(item => item.cantidad <= item.stockMinimo);
    const contenedor = document.getElementById("alertasInventario");
    if (!alertas.length) {
        contenedor.innerHTML = '<p class="all-clear">Inventario dentro de los mínimos configurados.</p>';
        return;
    }
    contenedor.innerHTML = alertas.map(item => `
        <p class="alert-item">
            <strong>${escapar(item.nombre)}</strong>: quedan ${item.cantidad.toFixed(2)} ${escapar(item.unidad)}
            (mínimo ${item.stockMinimo.toFixed(2)} ${escapar(item.unidad)})
        </p>
    `).join("");
}

function renderCostos() {
    const recargo = Math.max(0, Number(document.getElementById("recargoPrecio").value) || 0);
    const saboresConProduccion = sabores.filter(sabor => unidadesProducidas(sabor) > 0);
    document.getElementById("tablaCostos").innerHTML = saboresConProduccion.length
        ? saboresConProduccion.map(sabor => {
            const costo = costoPromedioProduccion(sabor);
            const precio = costo * (1 + recargo / 100);
            return `
                <tr>
                    <td>${escapar(sabor)}</td>
                    <td>${dinero(costo)}</td>
                    <td>${dinero(precio)}</td>
                    <td>${dinero(precio - costo)}</td>
                </tr>
            `;
        }).join("")
        : '<tr><td colspan="4">Registra producción para calcular costos y precios.</td></tr>';
}

function renderTodo() {
    actualizarSelectores();
    renderInventario();
    renderDashboard();
    renderAlertasInventario();
    renderSabores();
    renderRecetas();
    renderStockProductos();
    renderProducciones();
    renderVentas();
    renderGastos();
    renderGanancias();
    renderCostos();
}

function cancelarEdicion(tipo) {
    const campos = {
        inventario: ["nombreInsumo", "cantidadInsumo", "unidadInsumo", "precioInsumo", "stockMinimo"],
        recetas: ["saborReceta", "insumoReceta", "cantidadReceta"],
        producciones: ["saborProduccion", "cantidadProducida", "fechaProduccion"],
        ventas: ["saborVenta", "ventaCantidad", "ventaPrecio", "fechaVenta"],
        gastos: ["nombreGasto", "montoGasto", "fechaGasto"]
    };
    const botones = {
        inventario: ["guardarInsumoBtn", "cancelarInsumoBtn", "Agregar Insumo"],
        recetas: ["guardarRecetaBtn", "cancelarRecetaBtn", "Agregar a receta"],
        producciones: ["guardarProduccionBtn", "cancelarProduccionBtn", "Registrar Producción"],
        ventas: ["guardarVentaBtn", "cancelarVentaBtn", "Registrar Venta"],
        gastos: ["guardarGastoBtn", "cancelarGastoBtn", "Registrar Gasto"]
    };
    ediciones[tipo] = null;
    campos[tipo].forEach(id => {
        const campo = document.getElementById(id);
        if (campo.type === "date") campo.value = fechaHoy();
        else campo.value = "";
    });
    document.getElementById(botones[tipo][0]).textContent = botones[tipo][2];
    document.getElementById(botones[tipo][1]).hidden = true;
}

function prepararEdicion(tipo, id, valores) {
    ediciones[tipo] = id;
    Object.entries(valores).forEach(([campo, valor]) => {
        document.getElementById(campo).value = valor;
    });
    const botones = {
        inventario: ["guardarInsumoBtn", "cancelarInsumoBtn", "Guardar cambios"],
        recetas: ["guardarRecetaBtn", "cancelarRecetaBtn", "Guardar cambios"],
        producciones: ["guardarProduccionBtn", "cancelarProduccionBtn", "Guardar cambios"],
        ventas: ["guardarVentaBtn", "cancelarVentaBtn", "Guardar cambios"],
        gastos: ["guardarGastoBtn", "cancelarGastoBtn", "Guardar cambios"]
    }[tipo];
    document.getElementById(botones[0]).textContent = botones[2];
    document.getElementById(botones[1]).hidden = false;
}

function guardarInsumo() {
    const nombre = document.getElementById("nombreInsumo").value.trim();
    const cantidad = Number(document.getElementById("cantidadInsumo").value);
    const unidad = document.getElementById("unidadInsumo").value.trim() || "unidad";
    const precio = Number(document.getElementById("precioInsumo").value);
    const stockMinimo = Number(document.getElementById("stockMinimo").value || 0);
    if (!nombre || cantidad <= 0 || !Number.isFinite(precio) || precio < 0 || !Number.isFinite(stockMinimo) || stockMinimo < 0) {
        alert("Completa el nombre, una cantidad mayor a cero y un costo válido.");
        return;
    }

    const datos = { nombre, cantidad, unidad, precio, stockMinimo };
    const existente = inventario.find(item => item.id === ediciones.inventario);
    if (existente) Object.assign(existente, datos);
    else inventario.push({ id: crearId(), ...datos });
    cancelarEdicion("inventario");
    guardarDatos();
    renderTodo();
}

function editarInsumo(id) {
    const item = inventario.find(registro => registro.id === id);
    if (!item) return;
    prepararEdicion("inventario", id, {
        nombreInsumo: item.nombre,
        cantidadInsumo: item.cantidad,
        unidadInsumo: item.unidad,
        precioInsumo: item.precio,
        stockMinimo: item.stockMinimo
    });
}

function eliminarInsumo(id) {
    if (recetas.some(item => item.inventarioId === id) || producciones.some(item => item.consumos.some(consumo => consumo.inventarioId === id))) {
        alert("Este insumo está usado en recetas o producciones. Elimina esos registros antes.");
        return;
    }
    inventario = inventario.filter(item => item.id !== id);
    guardarDatos();
    renderTodo();
}

function agregarSabor() {
    const campo = document.getElementById("nuevoSabor");
    const sabor = campo.value.trim();
    if (!sabor) return;
    if (sabores.some(item => item.toLowerCase() === sabor.toLowerCase())) {
        alert("Ese sabor ya existe.");
        return;
    }
    sabores.push(sabor);
    campo.value = "";
    guardarDatos();
    renderTodo();
}

function editarSabor(indice) {
    const nuevoNombre = prompt("Editar nombre del sabor", sabores[indice]);
    if (nuevoNombre === null || !nuevoNombre.trim()) return;
    const anterior = sabores[indice];
    const nuevo = nuevoNombre.trim();
    if (sabores.some((sabor, posicion) => posicion !== indice && sabor.toLowerCase() === nuevo.toLowerCase())) {
        alert("Ese sabor ya existe.");
        return;
    }
    sabores[indice] = nuevo;
    recetas.forEach(item => { if (item.sabor === anterior) item.sabor = nuevo; });
    producciones.forEach(item => { if (item.sabor === anterior) item.sabor = nuevo; });
    ventas.forEach(item => { if (item.sabor === anterior) item.sabor = nuevo; });
    guardarDatos();
    renderTodo();
}

function eliminarSabor(indice) {
    const sabor = sabores[indice];
    if (recetas.some(item => item.sabor === sabor) || producciones.some(item => item.sabor === sabor) || ventas.some(item => item.sabor === sabor)) {
        alert("Este sabor tiene recetas o movimientos registrados y no se puede eliminar.");
        return;
    }
    sabores.splice(indice, 1);
    guardarDatos();
    renderTodo();
}

function guardarReceta() {
    const sabor = document.getElementById("saborReceta").value;
    const inventarioId = document.getElementById("insumoReceta").value;
    const cantidad = Number(document.getElementById("cantidadReceta").value);
    if (!sabor || !inventarioId || cantidad <= 0) {
        alert("Selecciona un sabor, un insumo y una cantidad válida.");
        return;
    }

    const existente = recetas.find(item => item.id === ediciones.recetas);
    const duplicada = recetas.find(item => item.sabor === sabor && item.inventarioId === inventarioId && item.id !== ediciones.recetas);
    if (duplicada) {
        alert("Ese insumo ya está en la receta. Edita el registro existente.");
        return;
    }
    const datos = { sabor, inventarioId, cantidad };
    if (existente) Object.assign(existente, datos);
    else recetas.push({ id: crearId(), ...datos });
    cancelarEdicion("recetas");
    guardarDatos();
    renderTodo();
}

function editarReceta(id) {
    const item = recetas.find(registro => registro.id === id);
    if (!item) return;
    prepararEdicion("recetas", id, {
        saborReceta: item.sabor,
        insumoReceta: item.inventarioId,
        cantidadReceta: item.cantidad
    });
}

function eliminarReceta(id) {
    recetas = recetas.filter(item => item.id !== id);
    guardarDatos();
    renderTodo();
}

function calcularConsumos(sabor, cantidad, produccionAnterior) {
    const receta = recetas.filter(item => item.sabor === sabor);
    if (!receta.length) throw new Error("Agrega al menos un insumo a la receta antes de producir.");

    const reposicion = new Map();
    (produccionAnterior ? produccionAnterior.consumos : []).forEach(consumo => {
        const previo = reposicion.get(consumo.inventarioId) || { cantidad: 0, costo: 0 };
        previo.cantidad += Number(consumo.cantidad) || 0;
        previo.costo += Number(consumo.costo) || 0;
        reposicion.set(consumo.inventarioId, previo);
    });

    const consumos = receta.map(linea => {
        const item = inventario.find(registro => registro.id === linea.inventarioId);
        if (!item) throw new Error("Hay un insumo eliminado en esta receta.");
        const anterior = reposicion.get(item.id) || { cantidad: 0, costo: 0 };
        const cantidadRequerida = linea.cantidad * cantidad;
        const cantidadDisponible = item.cantidad + anterior.cantidad;
        if (cantidadDisponible + 0.000001 < cantidadRequerida) {
            throw new Error(`Stock insuficiente de ${item.nombre}. Disponible: ${cantidadDisponible} ${item.unidad}.`);
        }
        const costoDisponible = item.precio + anterior.costo;
        const costoUnitario = cantidadDisponible > 0 ? costoDisponible / cantidadDisponible : 0;
        return {
            inventarioId: item.id,
            nombre: item.nombre,
            cantidad: cantidadRequerida,
            costo: cantidadRequerida * costoUnitario
        };
    });
    return consumos;
}

function aplicarConsumos(consumos) {
    consumos.forEach(consumo => {
        const item = inventario.find(registro => registro.id === consumo.inventarioId);
        if (!item) return;
        item.cantidad = Math.max(0, item.cantidad - consumo.cantidad);
        item.precio = Math.max(0, item.precio - consumo.costo);
    });
}

function restaurarConsumos(consumos) {
    consumos.forEach(consumo => {
        const item = inventario.find(registro => registro.id === consumo.inventarioId);
        if (!item) return;
        item.cantidad += Number(consumo.cantidad) || 0;
        item.precio += Number(consumo.costo) || 0;
    });
}

function guardarProduccion() {
    const sabor = document.getElementById("saborProduccion").value;
    const cantidad = Number(document.getElementById("cantidadProducida").value);
    const fecha = document.getElementById("fechaProduccion").value || fechaHoy();
    const anterior = producciones.find(item => item.id === ediciones.producciones);
    if (!sabor || !Number.isInteger(cantidad) || cantidad <= 0) {
        alert("Selecciona un sabor e indica una cantidad entera mayor a cero.");
        return;
    }
    if (unidadesProducidas(sabor, anterior ? anterior.id : null) + cantidad < unidadesVendidas(sabor)) {
        alert("No puedes dejar menos unidades producidas que las que ya se vendieron.");
        return;
    }

    let consumos;
    try {
        consumos = calcularConsumos(sabor, cantidad, anterior);
    } catch (error) {
        alert(error.message);
        return;
    }

    if (anterior) restaurarConsumos(anterior.consumos);
    aplicarConsumos(consumos);
    const costoTotal = consumos.reduce((total, item) => total + item.costo, 0);
    const datos = {
        id: anterior ? anterior.id : crearId(),
        sabor,
        cantidad,
        fecha,
        consumos,
        costoTotal,
        costoUnitario: cantidad ? costoTotal / cantidad : 0
    };
    if (anterior) Object.assign(anterior, datos);
    else producciones.push(datos);
    cancelarEdicion("producciones");
    guardarDatos();
    renderTodo();
}

function editarProduccion(id) {
    const item = producciones.find(registro => registro.id === id);
    if (!item) return;
    prepararEdicion("producciones", id, {
        saborProduccion: item.sabor,
        cantidadProducida: item.cantidad,
        fechaProduccion: item.fecha || fechaHoy()
    });
}

function eliminarProduccion(id) {
    const item = producciones.find(registro => registro.id === id);
    if (!item) return;
    if (unidadesProducidas(item.sabor, id) < unidadesVendidas(item.sabor)) {
        alert("No puedes eliminar esta producción: hay ventas que dependen de esas unidades.");
        return;
    }
    restaurarConsumos(item.consumos);
    producciones = producciones.filter(registro => registro.id !== id);
    guardarDatos();
    renderTodo();
}

function costoPromedioProduccion(sabor) {
    const lotes = producciones.filter(item => item.sabor === sabor);
    const totalUnidades = lotes.reduce((total, item) => total + item.cantidad, 0);
    if (!totalUnidades) return 0;
    return lotes.reduce((total, item) => total + item.costoTotal, 0) / totalUnidades;
}

function registrarVenta() {
    const sabor = document.getElementById("saborVenta").value;
    const cantidad = Number(document.getElementById("ventaCantidad").value);
    const precio = Number(document.getElementById("ventaPrecio").value);
    const fecha = document.getElementById("fechaVenta").value || fechaHoy();
    const anterior = ventas.find(item => item.id === ediciones.ventas);
    if (!sabor || !Number.isInteger(cantidad) || cantidad <= 0 || !Number.isFinite(precio) || precio < 0) {
        alert("Selecciona un sabor, una cantidad entera y un precio válido.");
        return;
    }
    const stockDisponible = unidadesProducidas(sabor) - unidadesVendidas(sabor, anterior ? anterior.id : null);
    if (cantidad > stockDisponible) {
        alert(`Stock insuficiente de ${sabor}. Disponible: ${stockDisponible} unidades.`);
        return;
    }

    const ingreso = cantidad * precio;
    const costo = cantidad * costoPromedioProduccion(sabor);
    const datos = {
        id: anterior ? anterior.id : crearId(),
        sabor,
        cantidad,
        precio,
        ingreso,
        costo,
        ganancia: ingreso - costo,
        fecha
    };
    if (anterior) Object.assign(anterior, datos);
    else ventas.push(datos);
    cancelarEdicion("ventas");
    guardarDatos();
    renderTodo();
}

function editarVenta(id) {
    const item = ventas.find(registro => registro.id === id);
    if (!item || item.sabor === "Registro anterior") {
        alert("Las ventas antiguas no tienen sabor registrado y no se pueden editar.");
        return;
    }
    prepararEdicion("ventas", id, {
        saborVenta: item.sabor,
        ventaCantidad: item.cantidad,
        ventaPrecio: item.precio,
        fechaVenta: item.fecha || fechaHoy()
    });
}

function eliminarVenta(id) {
    ventas = ventas.filter(item => item.id !== id);
    guardarDatos();
    renderTodo();
}

function guardarGasto() {
    const nombre = document.getElementById("nombreGasto").value.trim();
    const monto = Number(document.getElementById("montoGasto").value);
    const fecha = document.getElementById("fechaGasto").value || fechaHoy();
    if (!nombre || !Number.isFinite(monto) || monto < 0) {
        alert("Completa el concepto y un monto válido.");
        return;
    }
    const anterior = gastos.find(item => item.id === ediciones.gastos);
    const datos = { nombre, monto, fecha };
    if (anterior) Object.assign(anterior, datos);
    else gastos.push({ id: crearId(), ...datos });
    cancelarEdicion("gastos");
    guardarDatos();
    renderTodo();
}

function editarGasto(id) {
    const item = gastos.find(registro => registro.id === id);
    if (!item) return;
    prepararEdicion("gastos", id, {
        nombreGasto: item.nombre,
        montoGasto: item.monto,
        fechaGasto: item.fecha || fechaHoy()
    });
}

function eliminarGasto(id) {
    gastos = gastos.filter(item => item.id !== id);
    guardarDatos();
    renderTodo();
}

function exportarRespaldo() {
    const respaldo = {
        aplicacion: "MiJen Frozen",
        version: 1,
        exportadoEn: new Date().toISOString(),
        data: estadoActualNube()
    };
    const archivo = new Blob([JSON.stringify(respaldo, null, 2)], { type: "application/json" });
    const enlace = document.createElement("a");
    const url = URL.createObjectURL(archivo);
    enlace.href = url;
    enlace.download = `mijen-frozen-respaldo-${fechaHoy()}.json`;
    enlace.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    document.getElementById("estadoRespaldo").textContent = "Respaldo descargado.";
}

function importarRespaldo(evento) {
    const archivo = evento.target.files && evento.target.files[0];
    if (!archivo) return;
    const lector = new FileReader();
    lector.onload = () => {
        try {
            const respaldo = JSON.parse(lector.result);
            const datos = respaldo.data || respaldo;
            const secciones = ["inventario", "sabores", "recetas", "producciones", "ventas", "gastos"];
            if (!datos || !secciones.every(seccion => Array.isArray(datos[seccion]))) {
                throw new Error("El archivo no contiene un respaldo válido de MiJen Frozen.");
            }
            if (!confirm("Importar reemplazará todos los datos actuales. ¿Continuar?")) return;
            aplicarEstadoNube(datos);
            guardarDatos();
            document.getElementById("estadoRespaldo").textContent = "Respaldo importado y guardado.";
        } catch (error) {
            document.getElementById("estadoRespaldo").textContent = error.message || "No se pudo leer el respaldo.";
        } finally {
            evento.target.value = "";
        }
    };
    lector.onerror = () => {
        document.getElementById("estadoRespaldo").textContent = "No se pudo leer el archivo.";
        evento.target.value = "";
    };
    lector.readAsText(archivo);
}

function actualizarEstadoNube(mensaje) {
    const estado = document.getElementById("estadoNube");
    if (estado) estado.textContent = mensaje;
}

function actualizarControlesNube() {
    const configuracion = window.MIJEN_SUPABASE_CONFIG || {};
    const configurada = Boolean(configuracion.url && configuracion.publishableKey);
    document.getElementById("formularioNube").hidden = !configurada || Boolean(usuarioNube);
    document.getElementById("cerrarSesionNubeBtn").hidden = !usuarioNube;
    document.querySelectorAll(".requires-account").forEach(seccion => {
        seccion.hidden = !configurada || !usuarioNube || !datosNubeListos;
    });
}

function datosVaciosNube() {
    return { inventario: [], sabores: [], recetas: [], producciones: [], ventas: [], gastos: [] };
}

function aplicarEstadoNube(estado) {
    const datos = estado && typeof estado === "object" ? estado : datosVaciosNube();
    inventario = (Array.isArray(datos.inventario) ? datos.inventario : []).map(item => ({
        ...item,
        id: item.id || crearId(),
        nombre: String(item.nombre || ""),
        cantidad: Number(item.cantidad) || 0,
        unidad: item.unidad || "unidad",
        precio: Number(item.precio) || 0,
        stockMinimo: Number(item.stockMinimo) || 0
    }));
    sabores = (Array.isArray(datos.sabores) ? datos.sabores : []).map(sabor =>
        typeof sabor === "string" ? sabor : String(sabor.nombre || "")
    ).filter(Boolean);
    recetas = (Array.isArray(datos.recetas) ? datos.recetas : []).map(item => ({
        ...item,
        id: item.id || crearId(),
        cantidad: Number(item.cantidad) || 0
    }));
    producciones = (Array.isArray(datos.producciones) ? datos.producciones : []).map(item => ({
        ...item,
        id: item.id || crearId(),
        cantidad: Number(item.cantidad) || 0,
        costoTotal: Number(item.costoTotal) || 0,
        costoUnitario: Number(item.costoUnitario) || 0,
        consumos: Array.isArray(item.consumos) ? item.consumos : []
    }));
    ventas = (Array.isArray(datos.ventas) ? datos.ventas : []).map(item => ({
        ...item,
        id: item.id || crearId(),
        cantidad: Number(item.cantidad) || 0,
        precio: Number(item.precio) || 0,
        ingreso: Number(item.ingreso) || Number(item.cantidad) * Number(item.precio),
        costo: Number(item.costo) || 0,
        ganancia: Number(item.ganancia) || Number(item.ingreso) || 0,
        sabor: item.sabor || "Registro anterior",
        fecha: item.fecha || ""
    }));
    gastos = (Array.isArray(datos.gastos) ? datos.gastos : []).map(item => ({
        ...item,
        id: item.id || crearId(),
        monto: Number(item.monto) || 0
    }));
    guardarEnEsteDispositivo();
    renderTodo();
}

async function conectarCuentaNube(usuario) {
    if (usuarioNube && usuarioNube.id === usuario.id && canalNube) return;
    if (canalNube) await clienteNube.removeChannel(canalNube);
    usuarioNube = usuario;
    datosNubeListos = false;
    actualizarControlesNube();
    actualizarEstadoNube("Cargando datos de tu cuenta...");

    const { data, error } = await clienteNube
        .from("app_state")
        .select("data, updated_at")
        .eq("user_id", usuario.id)
        .maybeSingle();
    if (error) {
        actualizarEstadoNube(`No se pudieron cargar los datos: ${error.message}`);
        return;
    }

    if (data) {
        aplicarEstadoNube(data.data);
        ultimaActualizacionNube = data.updated_at;
    } else {
        const propietarioLocal = localStorage.getItem("mijen_cloud_owner");
        if (propietarioLocal && propietarioLocal !== usuario.id) {
            aplicarEstadoNube(datosVaciosNube());
        }
        const { data: nuevaFila, error: errorInicial } = await clienteNube
            .from("app_state")
            .insert({ user_id: usuario.id, data: estadoActualNube() })
            .select("updated_at")
            .single();
        if (errorInicial) {
            actualizarEstadoNube(`No se pudo crear el espacio en la nube: ${errorInicial.message}`);
            return;
        }
        ultimaActualizacionNube = nuevaFila.updated_at;
    }

    datosNubeListos = true;
    actualizarControlesNube();
    localStorage.setItem("mijen_cloud_owner", usuario.id);
    canalNube = clienteNube
        .channel(`mijen-state-${usuario.id}`)
        .on("postgres_changes", {
            event: "*",
            schema: "public",
            table: "app_state",
            filter: `user_id=eq.${usuario.id}`
        }, payload => {
            const fila = payload.new;
            if (!fila || fila.updated_at === ultimaActualizacionNube) return;
            ultimaActualizacionNube = fila.updated_at;
            aplicarEstadoNube(fila.data);
            actualizarEstadoNube("Datos sincronizados desde otro dispositivo.");
        })
        .subscribe(estado => {
            if (estado === "SUBSCRIBED") actualizarEstadoNube("Conectado. Tus datos se sincronizan entre dispositivos.");
            if (estado === "CHANNEL_ERROR" || estado === "TIMED_OUT") {
                actualizarEstadoNube("Sin conexión en tiempo real. Revisa Internet para sincronizar.");
            }
        });
    actualizarControlesNube();
}

async function iniciarSesionNube() {
    const email = document.getElementById("correoNube").value.trim();
    const password = document.getElementById("claveNube").value;
    if (!email || !password) {
        actualizarEstadoNube("Escribe tu correo y contraseña.");
        return;
    }
    actualizarEstadoNube("Iniciando sesión...");
    const { error } = await clienteNube.auth.signInWithPassword({ email, password });
    if (error) actualizarEstadoNube(`No se pudo iniciar sesión: ${error.message}`);
}

async function crearCuentaNube() {
    const email = document.getElementById("correoNube").value.trim();
    const password = document.getElementById("claveNube").value;
    if (!email || password.length < 6) {
        actualizarEstadoNube("Escribe un correo y una contraseña de al menos 6 caracteres.");
        return;
    }
    actualizarEstadoNube("Creando cuenta...");
    const { data, error } = await clienteNube.auth.signUp({ email, password });
    if (error) {
        actualizarEstadoNube(`No se pudo crear la cuenta: ${error.message}`);
        return;
    }
    if (!data.session) actualizarEstadoNube("Cuenta creada. Revisa tu correo para confirmar y luego inicia sesión.");
}

async function cerrarSesionNube() {
    const { error } = await clienteNube.auth.signOut();
    if (error) actualizarEstadoNube(`No se pudo cerrar sesión: ${error.message}`);
}

async function inicializarNube() {
    const configuracion = window.MIJEN_SUPABASE_CONFIG || {};
    if (!configuracion.url || !configuracion.publishableKey) {
        actualizarControlesNube();
        actualizarEstadoNube("Nube sin configurar. Sigue CONFIGURACION_CLOUD.md para conectar Supabase.");
        return;
    }
    if (!window.supabase || !window.supabase.createClient) {
        actualizarEstadoNube("No se pudo cargar Supabase. Revisa tu conexión a Internet.");
        return;
    }

    clienteNube = window.supabase.createClient(configuracion.url, configuracion.publishableKey);
    clienteNube.auth.onAuthStateChange((evento, sesion) => {
        if (sesion && sesion.user) {
            setTimeout(() => conectarCuentaNube(sesion.user), 0);
        } else if (usuarioNube) {
            if (canalNube) clienteNube.removeChannel(canalNube);
            canalNube = null;
            usuarioNube = null;
            datosNubeListos = false;
            actualizarControlesNube();
            actualizarEstadoNube("Sesión cerrada. Los cambios nuevos solo se guardan en este dispositivo.");
        }
    });

    actualizarControlesNube();
    actualizarEstadoNube("Conectando con Supabase...");
    const { data, error } = await clienteNube.auth.getSession();
    if (error) {
        actualizarEstadoNube(`No se pudo revisar la sesión: ${error.message}`);
        return;
    }
    if (data.session) await conectarCuentaNube(data.session.user);
    else actualizarEstadoNube("Inicia sesión o crea una cuenta para sincronizar tus datos.");
}

document.getElementById("fechaProduccion").value = fechaHoy();
document.getElementById("fechaVenta").value = fechaHoy();
document.getElementById("fechaGasto").value = fechaHoy();
renderTodo();
inicializarNube();