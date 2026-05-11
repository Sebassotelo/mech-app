import { useEffect, useRef, useCallback } from "react";

export default function useDismissibleModal(isOpen, onClose) {
  const modalRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return undefined;

    function handleKeyDown(event) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose?.();
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  const handleBackdropMouseDown = useCallback(
    (event) => {
      if (!isOpen) return;
      if (modalRef.current?.contains(event.target)) return;
      onClose?.();
    },
    [isOpen, onClose],
  );

  return { modalRef, handleBackdropMouseDown };
}
