// Router simple para navegación SPA
const Router = {
    routes: {},
    currentRoute: null,

    // Definir rutas
    addRoute(path, handler) {
        this.routes[path] = handler;
    },

    // Navegar a una ruta
    navigate(path) {
        if (this.routes[path]) {
            this.currentRoute = path;
            this.routes[path]();
            window.history.pushState({}, '', path);
        }
    },

    // Inicializar router
    init() {
        // Manejar navegación con botones del navegador
        window.addEventListener('popstate', () => {
            const path = window.location.pathname;
            if (this.routes[path]) {
                this.routes[path]();
            }
        });

        // Cargar ruta inicial
        const initialPath = window.location.pathname;
        if (this.routes[initialPath]) {
            this.routes[initialPath]();
        } else {
            // Ruta por defecto
            this.navigate('/');
        }
    }
};

// Definir rutas de la aplicación (si las necesitas para views diferentes)
Router.addRoute('/', () => {
    console.log('Ruta principal cargada');
});

Router.addRoute('/about', () => {
    console.log('Ruta About cargada');
    // Aquí podrías cargar about.html si lo necesitas
});

Router.addRoute('/contact', () => {
    console.log('Ruta Contact cargada');
    // Aquí podrías cargar contact.html si lo necesitas
});

// Función helper para cargar vistas (opcional)
async function loadView(viewPath) {
    try {
        const response = await fetch(viewPath);
        const html = await response.text();
        return html;
    } catch (error) {
        console.error('Error cargando vista:', error);
        return '<div>Error al cargar la vista</div>';
    }
}

// Exportar para uso en otros archivos
if (typeof module !== 'undefined' && module.exports) {
    module.exports = Router;
}