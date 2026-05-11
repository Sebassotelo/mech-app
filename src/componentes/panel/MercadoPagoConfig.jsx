"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  deleteField,
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import { toast } from "sonner";

const CONFIG_DOC_PATH = ["config", "mercadopago"];
const LOCATIONS = ["pv1", "pv2"];
const MP_PROVINCES = [
  "Buenos Aires",
  "Capital Federal",
  "Catamarca",
  "Chaco",
  "Chubut",
  "Corrientes",
  "Córdoba",
  "Entre Ríos",
  "Formosa",
  "Jujuy",
  "La Pampa",
  "La Rioja",
  "Mendoza",
  "Misiones",
  "Neuquén",
  "Río Negro",
  "Salta",
  "San Juan",
  "San Luis",
  "Santa Cruz",
  "Santa Fe",
  "Santiago del Estero",
  "Tierra del Fuego",
  "Tucumán",
];
const CABA_NEIGHBORHOODS = [
  "Agronomía",
  "Almagro",
  "Balvanera",
  "Barracas",
  "Barrio Norte",
  "Belgrano",
  "Belgrano Barrancas",
  "Belgrano C",
  "Belgrano Chico",
  "Belgrano R",
  "Boedo",
  "Botánico",
  "Caballito",
  "Chacarita",
  "Coghlan",
  "Colegiales",
  "Constitución",
  "Flores",
  "Floresta",
  "La Boca",
  "Las Cañitas",
  "Liniers",
  "Mataderos",
  "Monserrat",
  "Monte Castro",
  "Nueva Pompeya",
  "Núñez",
  "Palermo",
  "Palermo Chico",
  "Palermo Hollywood",
  "Palermo Nuevo",
  "Palermo Soho",
  "Palermo Viejo",
  "Parque Avellaneda",
  "Parque Chacabuco",
  "Parque Chas",
  "Parque Patricios",
  "Paternal",
  "Puerto Madero",
  "Recoleta",
  "Retiro",
  "Saavedra",
  "San Cristóbal",
  "San Nicolás",
  "San Telmo",
  "Santa Rita",
  "Velez Sarsfield",
  "Versailles",
  "Villa Crespo",
  "Villa Devoto",
  "Villa Gral. Mitre",
  "Villa Lugano",
  "Villa Luro",
  "Villa Ortúzar",
  "Villa Pueyrredón",
  "Villa Real",
  "Villa Riachuelo",
  "Villa Soldati",
  "Villa Urquiza",
  "Villa del Parque",
];

function locationLabel(location) {
  return location === "pv2" ? "Punto de venta 2" : "Punto de venta 1";
}

function normalizeId(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 60);
}

function defaultStoreForm(location) {
  const suffix = location.toUpperCase();
  return {
    name: `Sucursal ${suffix}`,
    externalId: normalizeId(`MECH_${suffix}_STORE`),
    location: {
      streetName: "",
      streetNumber: "",
      cityName: "",
      stateName: "",
      coordinates: "",
      reference: "",
    },
  };
}

function defaultPosForm(location) {
  const suffix = location.toUpperCase();
  return {
    name: `Caja ${suffix}`,
    externalPosId: normalizeId(`MECH_${suffix}_POS`),
  };
}

function defaultCheckoutForm(location) {
  const suffix = location.toUpperCase();
  return {
    displayName: `Local ${suffix}`,
    orderLabel: "Venta presencial",
  };
}

export default function MercadoPagoConfig({ firestore, auth }) {
  const [selectedLocation, setSelectedLocation] = useState("pv1");
  const [mpConfig, setMpConfig] = useState(null);
  const [loadingConfig, setLoadingConfig] = useState(true);
  const [account, setAccount] = useState(null);
  const [loadingAccount, setLoadingAccount] = useState(false);
  const [storeForm, setStoreForm] = useState(defaultStoreForm("pv1"));
  const [posForm, setPosForm] = useState(defaultPosForm("pv1"));
  const [checkoutForm, setCheckoutForm] = useState(defaultCheckoutForm("pv1"));
  const [savingStore, setSavingStore] = useState(false);
  const [savingPos, setSavingPos] = useState(false);
  const [savingCheckout, setSavingCheckout] = useState(false);
  const [resettingLocation, setResettingLocation] = useState(false);
  const [detectingLocation, setDetectingLocation] = useState(false);

  useEffect(() => {
    if (!firestore) return;
    const ref = doc(firestore, ...CONFIG_DOC_PATH);
    const unsub = onSnapshot(
      ref,
      (snap) => {
        setMpConfig(snap.exists() ? snap.data() : null);
        setLoadingConfig(false);
      },
      (err) => {
        console.error("RT mercadopago config:", err);
        setLoadingConfig(false);
        toast.error("No se pudo cargar la configuración de Mercado Pago");
      },
    );

    return () => unsub();
  }, [firestore]);

  useEffect(() => {
    const locationConfig = mpConfig?.locations?.[selectedLocation] || {};
    setStoreForm({
      name: locationConfig?.store?.name || defaultStoreForm(selectedLocation).name,
      externalId:
        locationConfig?.store?.externalId ||
        defaultStoreForm(selectedLocation).externalId,
      location: {
        streetName: locationConfig?.store?.location?.streetName || "",
        streetNumber: locationConfig?.store?.location?.streetNumber || "",
        cityName: locationConfig?.store?.location?.cityName || "",
        stateName: locationConfig?.store?.location?.stateName || "",
        coordinates:
          locationConfig?.store?.location?.coordinates ||
          [locationConfig?.store?.location?.latitude, locationConfig?.store?.location?.longitude]
            .filter(Boolean)
            .join(", "),
        reference: locationConfig?.store?.location?.reference || "",
      },
    });
    setPosForm({
      name: locationConfig?.pos?.name || defaultPosForm(selectedLocation).name,
      externalPosId:
        locationConfig?.pos?.externalId ||
        defaultPosForm(selectedLocation).externalPosId,
    });
    setCheckoutForm({
      displayName:
        locationConfig?.checkout?.displayName ||
        locationConfig?.store?.name ||
        defaultCheckoutForm(selectedLocation).displayName,
      orderLabel:
        locationConfig?.checkout?.orderLabel ||
        defaultCheckoutForm(selectedLocation).orderLabel,
    });
  }, [selectedLocation, mpConfig]);

  const locationConfig = mpConfig?.locations?.[selectedLocation] || null;
  const isCapitalFederal = storeForm.location?.stateName === "Capital Federal";
  const connectedLabel = useMemo(() => {
    const pieces = [account?.nickname, account?.email].filter(Boolean);
    return pieces.length ? pieces.join(" · ") : "Todavía no verificada";
  }, [account]);
  const savedAccountId = mpConfig?.account?.id || null;
  const connectedAccountId = account?.id || null;
  const accountMismatch =
    savedAccountId &&
    connectedAccountId &&
    String(savedAccountId) !== String(connectedAccountId);
  const locationStatus = getLocationStatus(locationConfig);

  async function getIdToken() {
    if (!auth?.currentUser) {
      throw new Error("No hay sesión activa");
    }
    return auth.currentUser.getIdToken();
  }

  async function fetchWithToken(url, options = {}) {
    const idToken = await getIdToken();
    const res = await fetch(url, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${idToken}`,
        ...(options.headers || {}),
      },
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data?.error || "Error de Mercado Pago");
    }

    return data;
  }

  async function saveConfigPatch(location, locationPatch, accountPatch = null) {
    if (!firestore) throw new Error("Firestore no disponible");

    const payload = {
      updatedAt: serverTimestamp(),
      locations: {
        [location]: {
          label: locationLabel(location),
          updatedAt: serverTimestamp(),
          ...(locationPatch || {}),
        },
      },
    };

    if (accountPatch) {
      payload.account = {
        ...accountPatch,
        updatedAt: serverTimestamp(),
      };
    }

    await setDoc(doc(firestore, ...CONFIG_DOC_PATH), payload, { merge: true });
  }

  async function refreshAccount() {
    setLoadingAccount(true);
    try {
      const data = await fetchWithToken("/api/mp/account", { method: "GET" });
      setAccount(data?.account || null);
      toast.success("Cuenta de Mercado Pago verificada");
    } catch (e) {
      console.error(e);
      toast.error(
        getFriendlyMpErrorMessage(
          e,
          "No se pudo verificar la cuenta de Mercado Pago.",
        ),
      );
    } finally {
      setLoadingAccount(false);
    }
  }

  async function handleCreateStore() {
    setSavingStore(true);
    try {
      const rawCoordinates = String(storeForm.location?.coordinates || "").trim();
      const [latitudeRaw = "", longitudeRaw = ""] = rawCoordinates
        .split(",")
        .map((part) => part.trim());
      const locationPayload = {
        street_name: String(storeForm.location?.streetName || "").trim(),
        street_number: String(storeForm.location?.streetNumber || "").trim(),
        city_name: String(storeForm.location?.cityName || "").trim(),
        state_name: String(storeForm.location?.stateName || "").trim(),
        latitude: latitudeRaw,
        longitude: longitudeRaw,
        reference: String(storeForm.location?.reference || "").trim(),
      };

      const data = await fetchWithToken("/api/mp/create-store", {
        method: "POST",
        body: JSON.stringify({
          name: storeForm.name,
          externalId: normalizeId(storeForm.externalId),
          location: locationPayload,
        }),
      });

      setAccount(data?.account || null);
      await saveConfigPatch(
        selectedLocation,
        {
          store: {
            id: data?.store?.id || null,
            name: data?.store?.name || storeForm.name,
            externalId: data?.store?.externalId || normalizeId(storeForm.externalId),
              location: {
                streetName: locationPayload.street_name,
                streetNumber: locationPayload.street_number,
                cityName: locationPayload.city_name,
                stateName: locationPayload.state_name,
                coordinates: rawCoordinates,
                latitude: String(locationPayload.latitude || ""),
                longitude: String(locationPayload.longitude || ""),
                reference: locationPayload.reference,
              },
            createdAt: serverTimestamp(),
          },
        },
        data?.account || null,
      );

      toast.success("Sucursal creada y guardada");
    } catch (e) {
      console.error(e);
      toast.error(
        getFriendlyMpErrorMessage(
          e,
          "No se pudo guardar la sucursal en Mercado Pago.",
        ),
      );
    } finally {
      setSavingStore(false);
    }
  }

  async function handleCreatePos() {
    const externalStoreId =
      locationConfig?.store?.externalId || normalizeId(storeForm.externalId);

    if (!externalStoreId) {
      return toast.error("Primero creá la sucursal de esta sede");
    }

    setSavingPos(true);
    try {
      const data = await fetchWithToken("/api/mp/create-pos", {
        method: "POST",
        body: JSON.stringify({
          name: posForm.name,
          externalStoreId,
          externalPosId: normalizeId(posForm.externalPosId),
        }),
      });

      setAccount(data?.account || null);
      await saveConfigPatch(
        selectedLocation,
        {
          store: {
            id: locationConfig?.store?.id || null,
            name: locationConfig?.store?.name || storeForm.name,
            externalId: externalStoreId,
            updatedAt: serverTimestamp(),
          },
          pos: {
            id: data?.pos?.id || null,
            name: data?.pos?.name || posForm.name,
            externalId: data?.pos?.externalId || normalizeId(posForm.externalPosId),
            storeId: data?.pos?.storeId || null,
            fixedAmount: !!data?.pos?.fixedAmount,
            qr: {
              image: data?.pos?.qr?.image || null,
              templateDocument: data?.pos?.qr?.templateDocument || null,
              templateImage: data?.pos?.qr?.templateImage || null,
            },
            createdAt: serverTimestamp(),
          },
        },
        data?.account || null,
      );

      toast.success("Caja creada. El QR ya está listo para imprimir.");
    } catch (e) {
      console.error(e);
      toast.error(
        getFriendlyMpErrorMessage(
          e,
          "No se pudo crear la caja con QR en Mercado Pago.",
        ),
      );
    } finally {
      setSavingPos(false);
    }
  }

  async function handleSaveCheckout() {
    setSavingCheckout(true);
    try {
      await saveConfigPatch(selectedLocation, {
        checkout: {
          displayName: String(checkoutForm.displayName || "").trim(),
          orderLabel: String(checkoutForm.orderLabel || "").trim(),
          updatedAt: serverTimestamp(),
        },
      });
      toast.success("Presentación del cobro guardada");
    } catch (e) {
      console.error(e);
      toast.error(
        getFriendlyMpErrorMessage(
          e,
          "No se pudo guardar cómo se mostrará el cobro.",
        ),
      );
    } finally {
      setSavingCheckout(false);
    }
  }

  async function handleResetLocation() {
    if (!firestore) {
      toast.error("Firestore no disponible");
      return;
    }

    if (!locationConfig) {
      toast.error("Esta sede no tiene configuración guardada para borrar.");
      return;
    }

    const confirmed = window.confirm(
      `Vas a borrar la configuración de ${locationLabel(selectedLocation)}. Esto elimina la sucursal, la caja, el QR y los textos guardados para esa sede. ¿Querés continuar?`,
    );

    if (!confirmed) return;

    setResettingLocation(true);
    try {
      await updateDoc(doc(firestore, ...CONFIG_DOC_PATH), {
        [`locations.${selectedLocation}`]: deleteField(),
        updatedAt: serverTimestamp(),
      });

      toast.success(`Configuración borrada para ${locationLabel(selectedLocation)}`);
    } catch (e) {
      console.error(e);
      toast.error("No se pudo resetear la configuración de esta sede.");
    } finally {
      setResettingLocation(false);
    }
  }

  function buildGoogleMapsUrl() {
    const query = [
      storeForm.location?.streetName,
      storeForm.location?.streetNumber,
      storeForm.location?.cityName,
      storeForm.location?.stateName,
    ]
      .filter(Boolean)
      .join(" ");

    if (!query.trim()) return null;
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
  }

  function openGoogleMaps() {
    const url = buildGoogleMapsUrl();
    if (!url) {
      toast.error("Completá calle, número, ciudad o provincia primero");
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
  }

  function useCurrentLocation() {
    if (!navigator?.geolocation) {
      toast.error("Este navegador no soporta geolocalización");
      return;
    }

    setDetectingLocation(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const coords = `${position.coords.latitude.toFixed(6)}, ${position.coords.longitude.toFixed(6)}`;
        setStoreForm((prev) => ({
          ...prev,
          location: {
            ...prev.location,
            coordinates: coords,
          },
        }));
        setDetectingLocation(false);
        toast.success("Coordenadas cargadas desde tu ubicación actual");
      },
      (error) => {
        console.error(error);
        setDetectingLocation(false);
        toast.error(
          "No se pudo obtener tu ubicación. Revisá los permisos del navegador.",
        );
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0,
      },
    );
  }

  return (
    <div className="rounded-xl border border-white/10 bg-[#0E2330]">
      <div className="h-1 w-full bg-gradient-to-r from-[#00A650] via-[#009EE3] to-[#00A650]" />
      <div className="p-4 sm:p-5 space-y-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <h4 className="text-lg font-semibold">Mercado Pago</h4>
            <p className="text-sm text-white/65">
              Dejá lista cada sede para cobrar con QR fijo, sin pasos técnicos.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={refreshAccount}
              disabled={loadingAccount}
              className="px-3.5 py-2 rounded-xl text-sm bg-white/10 hover:bg-white/15 disabled:opacity-60"
            >
              {loadingAccount ? "Verificando…" : "Verificar cuenta conectada"}
            </button>
            <button
              type="button"
              onClick={handleResetLocation}
              disabled={resettingLocation || !locationConfig}
              className="px-3.5 py-2 rounded-xl text-sm bg-red-500/15 text-red-100 ring-1 ring-red-400/20 hover:bg-red-500/20 disabled:opacity-60"
            >
              {resettingLocation ? "Reseteando sede…" : "Resetear esta sede"}
            </button>
          </div>
        </div>

        <div className="grid gap-3 lg:grid-cols-3">
          <InfoCard
            label="Cuenta conectada"
            value={connectedLabel}
            hint={
              connectedAccountId
                ? "Es la cuenta donde van a entrar los cobros."
                : "Tocá el botón para confirmar qué cuenta está vinculada."
            }
          />
          <InfoCard
            label="Cuenta guardada"
            value={
              mpConfig?.account?.nickname ||
              mpConfig?.account?.email ||
              "Todavía no guardada"
            }
            hint={
              savedAccountId
                ? "Es la última cuenta usada para guardar esta configuración."
                : "Se guarda automáticamente al crear la sucursal o la caja."
            }
          />
          <InfoCard
            label={`Estado ${locationLabel(selectedLocation)}`}
            value={locationStatus.value}
            hint={locationStatus.hint}
          />
        </div>

        {accountMismatch && (
          <div className="rounded-xl border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-50">
            La cuenta verificada ahora no coincide con la última cuenta guardada
            en esta configuración. Antes de seguir, confirmá que estás usando la
            cuenta correcta del local.
          </div>
        )}

        <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="space-y-4">
            <div className="rounded-xl border border-white/10 bg-white/5 p-3">
              <div className="flex flex-wrap items-center gap-2">
                {LOCATIONS.map((loc) => (
                  <button
                    key={loc}
                    type="button"
                    onClick={() => setSelectedLocation(loc)}
                    className={`px-3 py-1.5 rounded-lg text-sm ring-1 ring-white/10 ${
                      selectedLocation === loc ? "bg-white/15" : "bg-transparent hover:bg-white/5"
                    }`}
                  >
                    {locationLabel(loc)}
                  </button>
                ))}
              </div>
            </div>

            <div className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-3">
              <div>
                <h5 className="font-medium">1. Crear sucursal</h5>
                <p className="text-xs text-white/60">
                  Cargá los datos del local para dejar registrada esta sede en
                  Mercado Pago.
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field
                  label="Nombre sucursal"
                  value={storeForm.name}
                  onChange={(value) =>
                    setStoreForm((prev) => ({ ...prev, name: value }))
                  }
                  placeholder="Sucursal PV1"
                />
                <Field
                  label="Calle"
                  value={storeForm.location?.streetName || ""}
                  onChange={(value) =>
                    setStoreForm((prev) => ({
                      ...prev,
                      location: { ...prev.location, streetName: value },
                    }))
                  }
                  placeholder="Av. Siempre Viva"
                />
                <Field
                  label="Número"
                  value={storeForm.location?.streetNumber || ""}
                  onChange={(value) =>
                    setStoreForm((prev) => ({
                      ...prev,
                      location: { ...prev.location, streetNumber: value },
                    }))
                  }
                  placeholder="742"
                />
                <Field
                  label="Ciudad"
                  as={isCapitalFederal ? "select" : "input"}
                  value={storeForm.location?.cityName || ""}
                  onChange={(value) =>
                    setStoreForm((prev) => ({
                      ...prev,
                      location: { ...prev.location, cityName: value },
                    }))
                  }
                  options={isCapitalFederal ? CABA_NEIGHBORHOODS : []}
                  placeholder={
                    isCapitalFederal
                      ? "Seleccioná un barrio de CABA"
                      : "Córdoba"
                  }
                />
                <Field
                  label="Provincia"
                  as="select"
                  value={storeForm.location?.stateName || ""}
                  onChange={(value) =>
                    setStoreForm((prev) => ({
                      ...prev,
                      location: { ...prev.location, stateName: value },
                    }))
                  }
                  options={MP_PROVINCES}
                  placeholder="Seleccioná una provincia"
                />
                <Field
                  label="Coordenadas"
                  value={storeForm.location?.coordinates || ""}
                  onChange={(value) =>
                    setStoreForm((prev) => ({
                      ...prev,
                      location: { ...prev.location, coordinates: value },
                    }))
                  }
                  placeholder="-31.4201, -64.1888"
                />
               </div>
               <p className="text-xs text-white/50">
                 El identificador interno de la sucursal se genera y se guarda
                 automáticamente.
               </p>
               <Field
                 label="Referencia"
                 value={storeForm.location?.reference || ""}
                 onChange={(value) =>
                   setStoreForm((prev) => ({
                     ...prev,
                     location: { ...prev.location, reference: value },
                   }))
                 }
                 placeholder="Frente al local / esquina / piso"
               />
               <div className="flex flex-wrap gap-2">
                 <button
                   type="button"
                   onClick={useCurrentLocation}
                   disabled={detectingLocation}
                   className="px-3 py-2 rounded-xl text-sm bg-white/10 hover:bg-white/15 disabled:opacity-60"
                 >
                   {detectingLocation ? "Buscando ubicación…" : "Usar mi ubicación actual"}
                 </button>
                 <button
                   type="button"
                   onClick={openGoogleMaps}
                   className="px-3 py-2 rounded-xl text-sm bg-white/10 hover:bg-white/15"
                 >
                   Abrir dirección en Google Maps
                 </button>
               </div>
               <p className="text-xs text-white/55">
                 Pegá las coordenadas en un solo campo, por ejemplo <span className="font-mono">-31.4201, -64.1888</span>. Las podés copiar con click derecho en Google Maps sobre el local.
               </p>
               {isCapitalFederal && (
                 <p className="text-xs text-amber-100/80">
                   Para <span className="font-medium">Capital Federal</span>, Mercado Pago exige que la ciudad sea un barrio válido de CABA.
                 </p>
               )}
               <p className="text-xs text-white/45">
                 "Usar mi ubicación actual" sirve solo si estás físicamente en el local. Si estás configurando desde otro lugar, usá Google Maps.
               </p>
               <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleCreateStore}
                  disabled={savingStore}
                  className="px-3.5 py-2 rounded-xl text-sm text-white bg-gradient-to-r from-[#00A650] to-[#009EE3] hover:brightness-110 disabled:opacity-60"
                >
                  {savingStore ? "Guardando sucursal…" : "Guardar sucursal"}
                </button>
                {locationConfig?.store?.id && (
                  <span className="text-xs text-white/60">
                    Sucursal guardada: {locationConfig.store.name}
                  </span>
                )}
              </div>
            </div>

            <div className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-3">
              <div>
                <h5 className="font-medium">2. Crear caja y QR</h5>
                <p className="text-xs text-white/60">
                  Esto crea la caja de cobro para esta sede y genera el QR fijo
                  que después podés imprimir.
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-1">
                <Field
                  label="Nombre caja"
                  value={posForm.name}
                  onChange={(value) =>
                    setPosForm((prev) => ({ ...prev, name: value }))
                  }
                  placeholder="Caja PV1"
                />
              </div>
              <p className="text-xs text-white/50">
                El identificador interno de la caja también se genera de forma
                automática para esta sede.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleCreatePos}
                  disabled={savingPos}
                  className="px-3.5 py-2 rounded-xl text-sm text-white bg-gradient-to-r from-[#00A650] to-[#009EE3] hover:brightness-110 disabled:opacity-60"
                >
                  {savingPos ? "Creando caja…" : "Crear caja y generar QR"}
                </button>
                {locationConfig?.pos?.externalId && (
                  <span className="text-xs text-white/60">
                    Caja lista para esta sede.
                  </span>
                )}
              </div>
            </div>

            <div className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-2">
              <h5 className="font-medium">3. Cómo verá el cobro tu cliente</h5>
              <p className="text-xs text-white/60">
                Estos textos aparecen al momento de pagar, para que el cobro se
                vea claro en Mercado Pago.
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field
                  label="Nombre visible del local"
                  value={checkoutForm.displayName}
                  onChange={(value) =>
                    setCheckoutForm((prev) => ({ ...prev, displayName: value }))
                  }
                  placeholder="Mecánica Centro"
                />
                <Field
                  label="Leyenda del cobro"
                  value={checkoutForm.orderLabel}
                  onChange={(value) =>
                    setCheckoutForm((prev) => ({ ...prev, orderLabel: value }))
                  }
                  placeholder="Venta presencial"
                />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleSaveCheckout}
                  disabled={savingCheckout}
                  className="px-3.5 py-2 rounded-xl text-sm bg-white/10 hover:bg-white/15 disabled:opacity-60"
                >
                  {savingCheckout ? "Guardando..." : "Guardar presentación"}
                </button>
                <span className="text-xs text-white/55">
                  Esto afecta nuevas ventas de la sede seleccionada.
                </span>
              </div>
            </div>

            <div className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-2">
              <h5 className="font-medium">4. Paso a paso recomendado</h5>
              <ol className="list-decimal pl-5 space-y-1 text-sm text-white/75">
                <li>Verificá primero que la cuenta conectada sea la del local correcto.</li>
                <li>Elegí la sede que querés preparar.</li>
                <li>Guardá la sucursal con los datos del local.</li>
                <li>Creá la caja para generar el QR fijo de esa sede.</li>
                <li>Abrí el PDF o la imagen del QR y dejalo listo para imprimir.</li>
                <li>Si la cuenta mostrada no corresponde al local, frená y pedí ayuda antes de continuar.</li>
              </ol>
            </div>
          </div>

          <div className="space-y-4">
            <div className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-3">
              <h5 className="font-medium">QR actual de la sede</h5>
              {loadingConfig ? (
                <p className="text-sm text-white/60">Cargando configuración…</p>
              ) : locationConfig?.pos?.qr?.image ? (
                <>
                  <div className="rounded-xl bg-white p-3">
                    <img
                      src={locationConfig.pos.qr.image}
                      alt={`QR ${selectedLocation}`}
                      className="mx-auto h-56 w-56 object-contain"
                    />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {locationConfig?.pos?.qr?.templateDocument && (
                      <a
                        href={locationConfig.pos.qr.templateDocument}
                        target="_blank"
                        rel="noreferrer"
                        className="px-3 py-2 rounded-xl text-sm bg-white/10 hover:bg-white/15"
                      >
                        Abrir PDF para imprimir
                      </a>
                    )}
                    {locationConfig?.pos?.qr?.templateImage && (
                      <a
                        href={locationConfig.pos.qr.templateImage}
                        target="_blank"
                        rel="noreferrer"
                        className="px-3 py-2 rounded-xl text-sm bg-white/10 hover:bg-white/15"
                      >
                        Abrir imagen del QR
                      </a>
                    )}
                  </div>
                </>
              ) : (
                <p className="text-sm text-white/60">
                  Todavía no hay QR guardado para esta sede.
                </p>
              )}
            </div>

            <div className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-2">
              <h5 className="font-medium">Antes de terminar</h5>
              <p className="text-sm text-white/70">
                Antes de dar por lista esta sede, revisá estos puntos para evitar
                confusiones en el local.
              </p>
              <ol className="list-decimal pl-5 space-y-1 text-sm text-white/70">
                <li>Confirmá que el nombre del local esté bien escrito.</li>
                <li>Verificá que la dirección y las coordenadas correspondan a esa sede.</li>
                <li>Comprobá que el QR se vea y se pueda abrir para imprimir.</li>
                <li>Si el local tiene más de una sede, repetí el proceso en la otra.</li>
              </ol>
            </div>

            <div className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-2">
              <h5 className="font-medium">Si necesitás ayuda</h5>
              <ul className="list-disc pl-5 space-y-1 text-sm text-white/70">
                <li>Si la cuenta mostrada no es la del local, no continúes con la configuración.</li>
                <li>Si no podés verificar la cuenta o crear la caja, pedile ayuda a quien instaló la app.</li>
                <li>Una vez guardada la caja, las próximas ventas de esa sede podrán usar ese QR.</li>
              </ul>
            </div>

            <div className="rounded-xl border border-red-400/20 bg-red-500/10 p-4 space-y-2">
              <h5 className="font-medium text-red-100">Resetear esta sede</h5>
              <p className="text-sm text-red-50/85">
                Si necesitás empezar de nuevo, podés borrar solo la configuración
                de la sede seleccionada sin afectar a las demás.
              </p>
              <p className="text-xs text-red-100/75">
                Se eliminan la sucursal, la caja, el QR y los textos guardados
                para {locationLabel(selectedLocation)}.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function getFriendlyMpErrorMessage(error, fallbackMessage) {
  const message = String(error?.message || "").toLowerCase();

  if (message.includes("mp_access_token") || message.includes("e_no_mp_token")) {
    return "La cuenta de Mercado Pago todavía no está conectada en el sistema. Pedile ayuda a quien instaló la app para terminar esa vinculación.";
  }

  if (message.includes("no hay sesión")) {
    return "Necesitás iniciar sesión de nuevo para continuar con esta configuración.";
  }

  return fallbackMessage;
}

function getLocationStatus(locationConfig) {
  const hasStore = Boolean(locationConfig?.store?.id);
  const hasPos = Boolean(locationConfig?.pos?.id);
  const hasQr = Boolean(locationConfig?.pos?.qr?.image);

  if (hasQr) {
    return {
      value: "Lista para cobrar",
      hint: "La sede ya tiene sucursal, caja y QR guardados.",
    };
  }

  if (hasPos) {
    return {
      value: "Caja creada",
      hint: "La sede ya tiene caja. Revisá el QR antes de imprimirlo.",
    };
  }

  if (hasStore) {
    return {
      value: "Falta crear la caja",
      hint: "La sucursal ya está guardada. El siguiente paso es generar el QR.",
    };
  }

  return {
    value: "Pendiente de configurar",
    hint: "Empezá por guardar la sucursal de esta sede.",
  };
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  as = "input",
  options = [],
}) {
  return (
    <div>
      <label className="text-xs text-white/70">{label}</label>
      {as === "select" ? (
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full mt-1 px-3.5 py-2 rounded-xl bg-[#0C212D] border border-white/10 text-sm outline-none focus:ring-2 ring-[#009EE3]/60"
        >
          <option value="">{placeholder || "Seleccionar"}</option>
          {options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      ) : (
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full mt-1 px-3.5 py-2 rounded-xl bg-[#0C212D] border border-white/10 text-sm outline-none focus:ring-2 ring-[#009EE3]/60"
          placeholder={placeholder}
        />
      )}
    </div>
  );
}

function InfoCard({ label, value, hint }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-3">
      <div className="text-xs uppercase tracking-widest text-white/45">{label}</div>
      <div className="mt-1 break-words text-sm font-medium">{value || "—"}</div>
      <div className="mt-1 text-xs text-white/50">{hint}</div>
    </div>
  );
}
