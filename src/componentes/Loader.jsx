import React from "react";

export default function Loader({ text = "Cargando...", fullScreen = false }) {
  // Clases dinámicas dependiendo de si es a pantalla completa o dentro de un contenedor
  const containerClass = fullScreen
    ? "fixed inset-0 z-[100] flex flex-col items-center justify-center bg-[#0C212D]/80 backdrop-blur-sm"
    : "flex flex-col items-center justify-center w-full p-10 min-h-[200px]";

  return (
    <div className={containerClass}>
      {/* Contenedor principal de la animación */}
      <div className="relative flex items-center justify-center w-16 h-16 mb-5">
        {/* Anillo exterior (Gira normal) */}
        <div className="absolute inset-0 rounded-full border-2 border-white/10 border-t-[#EE7203] animate-spin"></div>

        {/* Anillo interior (Gira en sentido contrario) */}
        {/* Usamos un custom tailwind class para girar al revés */}
        <div className="absolute inset-2 rounded-full border-2 border-white/5 border-b-[#FF3816] animate-[spin_1.5s_linear_infinite_reverse]"></div>

        {/* Núcleo brillante (Pulsa) */}
        <div className="absolute inset-5 rounded-full bg-gradient-to-tr from-[#EE7203] to-[#FF3816] opacity-80 blur-[4px] animate-pulse"></div>

        {/* Punto central sólido */}
        <div className="absolute inset-6 rounded-full bg-white shadow-lg"></div>
      </div>

      {/* Texto descriptivo */}
      {text && (
        <div className="flex items-center gap-1">
          <span className="text-xs font-bold text-white/50 uppercase tracking-[0.25em] animate-pulse">
            {text}
          </span>
        </div>
      )}
    </div>
  );
}
