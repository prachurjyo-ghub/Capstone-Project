"use client";

import * as Dialog from "./ui/dialog";
import * as Select from "./ui/select";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  FiArrowLeft,
  FiArrowRight,
  FiArrowUpRight,
  FiCamera,
  FiCheck,
  FiChevronDown,
  FiPlus,
  FiTrash2,
  FiUploadCloud,
  FiX,
} from "react-icons/fi";
import { categoryCredits, type RequestMode } from "@/lib/data";
import { useSite, type DialogState } from "./site-context";
import { ActionButton, Kicker } from "./ui";
import { AuthForm } from "./auth-form";

const modeTitle: Record<RequestMode, string> = {
  standard: "SUBMIT A SOURCING REQUEST",
  photo: "PHOTO-BASED PARTS REQUEST",
  urgent: "URGENT PARTS REQUEST",
  garage: "GARAGE PARTS REQUEST",
  fleet: "FLEET SUPPLY INQUIRY",
};

const MAX_PHOTOS_PER_PART = 3;
const MAX_REQUEST_PHOTOS = 5;
const MAX_REQUEST_ITEMS = 50;
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

type PreparedPhoto = { id: string; file: File; previewUrl: string };
type PartEditor = {
  id: number;
  description: string;
  quantity: number;
  photos: PreparedPhoto[];
};

function RequestForm({
  state,
  onDirtyChange,
}: {
  state: Extract<DialogState, { kind: "request" }>;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const {
    basket,
    catalogueProducts,
    saveRequest,
    vehicles,
    customer,
    addresses,
  } = useSite();
  const basketNames = state.fromBasket
    ? basket
        .map((id) => catalogueProducts.find((p) => p.id === id)?.name)
        .filter((name): name is string => Boolean(name))
    : [];
  const initialDescriptions = basketNames.length
    ? basketNames
    : [state.part ?? ""];
  const nextPartId = useRef(initialDescriptions.length + 1);
  const [parts, setParts] = useState<PartEditor[]>(() =>
    initialDescriptions.map((description, index) => ({
      id: index + 1,
      description,
      quantity: 1,
      photos: [],
    })),
  );
  const [urgency, setUrgency] = useState(
    state.mode === "urgent" ? "Urgent sourcing" : "Standard sourcing",
  );
  const [step, setStep] = useState(1);
  const [selectedVehicleId, setSelectedVehicleId] = useState("");
  const [vehicle, setVehicle] = useState("");
  const [year, setYear] = useState("");
  const [chassis, setChassis] = useState("");
  const defaultAddress = addresses.find((address) => address.isDefault);
  const [selectedAddressId, setSelectedAddressId] = useState(
    defaultAddress?.id ?? "",
  );
  const [area, setArea] = useState(
    state.area ??
      (defaultAddress ? `${defaultAddress.area}, ${defaultAddress.city}` : ""),
  );
  const [phone, setPhone] = useState(customer?.phone ?? "");
  const [notes, setNotes] = useState("");
  const [business, setBusiness] = useState("");
  const [previewPhoto, setPreviewPhoto] = useState<PreparedPhoto | null>(null);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const partsRef = useRef(parts);
  const formBodyRef = useRef<HTMLDivElement>(null);
  const [initiallyDirty] = useState(() => initialDescriptions.some(Boolean));

  useEffect(() => {
    partsRef.current = parts;
  }, [parts]);
  useEffect(() => {
    onDirtyChange(initiallyDirty);
    return () => {
      for (const part of partsRef.current) {
        for (const photo of part.photos) URL.revokeObjectURL(photo.previewUrl);
      }
      onDirtyChange(false);
    };
  }, [initiallyDirty, onDirtyChange]);
  useEffect(() => {
    if (!error) return;
    const frame = window.requestAnimationFrame(() => {
      const body = formBodyRef.current;
      if (body) body.scrollTop = body.scrollHeight;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [error, step]);

  const markDirty = () => onDirtyChange(true);
  const totalPhotos = parts.reduce((total, part) => total + part.photos.length, 0);

  function updatePart(id: number, change: Partial<PartEditor>) {
    markDirty();
    setParts((current) =>
      current.map((part) => (part.id === id ? { ...part, ...change } : part)),
    );
    setError("");
  }

  function addPart() {
    if (parts.length >= MAX_REQUEST_ITEMS) return;
    markDirty();
    setParts((current) => [
      ...current,
      { id: nextPartId.current++, description: "", quantity: 1, photos: [] },
    ]);
  }

  function removePart(id: number) {
    const target = parts.find((part) => part.id === id);
    if (!target || parts.length === 1) return;
    const hasContent = Boolean(target.description.trim() || target.photos.length);
    if (hasContent && !window.confirm("Remove this part and its selected photos?")) {
      return;
    }
    for (const photo of target.photos) URL.revokeObjectURL(photo.previewUrl);
    markDirty();
    setParts((current) => current.filter((part) => part.id !== id));
  }

  function addPhotos(partId: number, files: FileList | null) {
    if (!files?.length) return;
    const target = parts.find((part) => part.id === partId);
    if (!target) return;
    const remainingForPart = MAX_PHOTOS_PER_PART - target.photos.length;
    const remainingForRequest = MAX_REQUEST_PHOTOS - totalPhotos;
    const capacity = Math.min(remainingForPart, remainingForRequest);
    const candidates = [...files];
    const invalid = candidates.find(
      (file) =>
        !["image/jpeg", "image/png"].includes(file.type) ||
        file.size > MAX_PHOTO_BYTES,
    );
    if (invalid) {
      setError(
        invalid.size > MAX_PHOTO_BYTES
          ? `${invalid.name} is larger than 5 MiB.`
          : `${invalid.name} is not a JPEG or PNG image.`,
      );
      return;
    }
    if (capacity < 1) {
      setError(
        totalPhotos >= MAX_REQUEST_PHOTOS
          ? "A request can contain at most five photos in total."
          : "Each part can contain at most three photos.",
      );
      return;
    }
    const existing = new Set(
      target.photos.map(
        ({ file }) => `${file.name}:${file.size}:${file.lastModified}`,
      ),
    );
    const prepared = candidates
      .filter(
        (file) => !existing.has(`${file.name}:${file.size}:${file.lastModified}`),
      )
      .slice(0, capacity)
      .map((file) => ({
        id: `${file.name}:${file.size}:${file.lastModified}`,
        file,
        previewUrl: URL.createObjectURL(file),
      }));
    if (!prepared.length) {
      setError("That photo is already attached to this part.");
      return;
    }
    updatePart(partId, { photos: [...target.photos, ...prepared] });
    if (prepared.length < candidates.length) {
      setError("Only the remaining available photo slots were added.");
    }
  }

  function removePhoto(partId: number, photoId: string) {
    const target = parts.find((part) => part.id === partId);
    const photo = target?.photos.find((item) => item.id === photoId);
    if (!target || !photo) return;
    URL.revokeObjectURL(photo.previewUrl);
    updatePart(partId, {
      photos: target.photos.filter((item) => item.id !== photoId),
    });
    if (previewPhoto?.id === photoId) setPreviewPhoto(null);
  }

  function validatePartStep() {
    const invalidIndex = parts.findIndex(
      (part) => !part.description.trim() && part.photos.length === 0,
    );
    if (invalidIndex >= 0) {
      setError(`Part ${invalidIndex + 1} needs a description or at least one photo.`);
      return false;
    }
    return true;
  }

  function continueFrom(currentStep: number) {
    if (currentStep === 1 && !validatePartStep()) return;
    if (currentStep === 2 && !vehicle.trim()) {
      setError("Add the car make and model before continuing.");
      return;
    }
    setError("");
    setStep(Math.min(3, currentStep + 1));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!validatePartStep()) {
      setStep(1);
      return;
    }
    if (!vehicle.trim()) {
      setError("Add the car make and model.");
      setStep(2);
      return;
    }
    if (!area.trim() || !/^\+[1-9]\d{7,14}$/.test(phone.trim())) {
      setError("Add a delivery area and a contact number in international format.");
      setStep(3);
      return;
    }
    setSubmitting(true);
    const failure = await saveRequest(
      {
        parts: parts.map((part) => ({
          description: part.description.trim(),
          quantity: part.quantity,
          photos: part.photos.map((photo) => photo.file),
        })),
        vehicle: vehicle.trim(),
        vehicleId: selectedVehicleId || undefined,
        year: year.trim(),
        chassis: chassis.trim(),
        area: area.trim(),
        deliveryAddressId: selectedAddressId || undefined,
        phone: phone.trim(),
        urgency,
        notes: notes.trim(),
        business: business.trim() || undefined,
        mode: state.mode,
      },
      Boolean(state.fromBasket),
    );
    setSubmitting(false);
    if (failure) setError(failure);
    else onDirtyChange(false);
  }

  const stepClass = (value: number) =>
    `${step === value ? "block" : "hidden"} sm:block`;

  return (
    <form
      onSubmit={submit}
      noValidate
      className="request-form flex min-h-0 flex-1 flex-col"
    >
      <header className="request-form-header shrink-0 border-b border-[var(--line)] bg-[var(--surface)] px-5 py-4 pr-16 sm:px-8 sm:py-6 sm:pr-16">
        <Kicker>{modeTitle[state.mode]}</Kicker>
        <div className="mt-2 flex items-end justify-between gap-5">
          <div>
            <Dialog.Title className="font-heading text-[24px] font-extrabold leading-tight tracking-[-.035em] sm:text-[34px]">
              What parts do you need?
            </Dialog.Title>
            <Dialog.Description className="mt-1.5 text-[13px] leading-relaxed text-[var(--muted)] sm:text-sm">
              Add a photo or describe the part. We&apos;ll help with the rest.
            </Dialog.Description>
          </div>
          <span className="shrink-0 text-xs font-bold text-[var(--accent)] sm:hidden">
            {step} of 3
          </span>
        </div>
      </header>

      <div
        ref={formBodyRef}
        className="request-form-body min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-8 sm:py-7"
      >
        <section className={stepClass(1)} aria-labelledby="parts-section-title">
          <div className="request-section-heading">
            <span>01</span>
            <div>
              <h3 id="parts-section-title">Parts needed</h3>
              <p>A description or photo is enough to start each item.</p>
            </div>
          </div>
          <div className="mt-4 space-y-4">
            {parts.map((part, index) => (
              <article className="request-part-card" key={part.id}>
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <span className="text-[10px] font-extrabold tracking-[.12em] text-[var(--accent)]">
                      PART {index + 1}
                    </span>
                    <h4 className="font-heading text-base font-extrabold text-[var(--heading)]">
                      {part.description.trim() || "Part details"}
                    </h4>
                  </div>
                  {parts.length > 1 && (
                    <button
                      type="button"
                      className="icon-action text-red-600"
                      onClick={() => removePart(part.id)}
                      aria-label={`Remove part ${index + 1}`}
                    >
                      <FiTrash2 aria-hidden="true" />
                    </button>
                  )}
                </div>
                <label className="field-label mt-4">
                  What part do you need?
                  <small>Name, description, or symptom</small>
                  <textarea
                    rows={2}
                    maxLength={600}
                    dir="auto"
                    value={part.description}
                    onChange={(event) =>
                      updatePart(part.id, { description: event.target.value })
                    }
                    placeholder="e.g. Front brake pads or a rattling engine noise"
                    className="field-control"
                  />
                </label>
                <div className="mt-4 grid gap-4 sm:grid-cols-[1fr_140px]">
                  <div>
                    <span className="field-label">Add photos of the part</span>
                    <small className="mt-1 block text-[11px] leading-relaxed text-[var(--muted)]">
                      Up to 3 per part; 5 total. JPEG or PNG, up to 5 MiB each.
                    </small>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {part.photos.map((photo, photoIndex) => (
                        <div className="photo-tile" key={photo.id}>
                          <button
                            type="button"
                            onClick={() => setPreviewPhoto(photo)}
                            aria-label={`Preview photo ${photoIndex + 1} for part ${index + 1}`}
                          >
                            <Image
                              src={photo.previewUrl}
                              alt=""
                              fill
                              sizes="96px"
                              unoptimized
                              className="object-cover"
                            />
                          </button>
                          <button
                            type="button"
                            className="photo-remove"
                            onClick={() => removePhoto(part.id, photo.id)}
                            aria-label={`Remove photo ${photoIndex + 1} from part ${index + 1}`}
                          >
                            <FiX aria-hidden="true" />
                          </button>
                        </div>
                      ))}
                      {part.photos.length < MAX_PHOTOS_PER_PART &&
                        totalPhotos < MAX_REQUEST_PHOTOS && (
                          <label className="photo-add-tile">
                            <FiUploadCloud size={21} aria-hidden="true" />
                            <span>Add photos</span>
                            <input
                              type="file"
                              accept="image/jpeg,image/png"
                              multiple
                              className="sr-only"
                              onChange={(event) => {
                                addPhotos(part.id, event.target.files);
                                event.target.value = "";
                              }}
                            />
                          </label>
                        )}
                      {part.photos.length < MAX_PHOTOS_PER_PART &&
                        totalPhotos < MAX_REQUEST_PHOTOS && (
                          <label className="photo-camera-tile">
                            <FiCamera size={18} aria-hidden="true" />
                            <span>Camera</span>
                            <input
                              type="file"
                              accept="image/jpeg,image/png"
                              capture="environment"
                              className="sr-only"
                              onChange={(event) => {
                                addPhotos(part.id, event.target.files);
                                event.target.value = "";
                              }}
                            />
                          </label>
                        )}
                    </div>
                    <span className="mt-2 block text-[11px] font-bold text-[var(--muted)]">
                      {part.photos.length} of {MAX_PHOTOS_PER_PART} for this part · {totalPhotos} of {MAX_REQUEST_PHOTOS} total
                    </span>
                  </div>
                  <label className="field-label">
                    Quantity needed
                    <input
                      type="number"
                      min="1"
                      max="999"
                      required
                      value={part.quantity}
                      onChange={(event) =>
                        updatePart(part.id, {
                          quantity: Math.max(1, Number(event.target.value) || 1),
                        })
                      }
                      className="field-control"
                    />
                  </label>
                </div>
              </article>
            ))}
          </div>
          <button
            type="button"
            className="secondary-button mt-4 w-full gap-2 border-dashed sm:w-auto"
            onClick={addPart}
            disabled={parts.length >= MAX_REQUEST_ITEMS}
          >
            <FiPlus aria-hidden="true" /> Add another part
          </button>
        </section>

        <section className={`${stepClass(2)} sm:mt-8`} aria-labelledby="vehicle-section-title">
          <div className="request-section-heading">
            <span>02</span>
            <div>
              <h3 id="vehicle-section-title">Your vehicle</h3>
              <p>Vehicle context helps suppliers check compatibility.</p>
            </div>
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
        {vehicles.length > 0 && (
          <label className="field-label sm:col-span-2">
            Use a saved vehicle
            <select
              className="field-control select-control"
              value={selectedVehicleId}
              onChange={(event) => {
                markDirty();
                setSelectedVehicleId(event.target.value);
                const selected = vehicles.find(
                  (item) => item.id === event.target.value,
                );
                if (selected) {
                  setVehicle(`${selected.make} ${selected.model}`);
                  setYear(
                    [selected.year, selected.variant]
                      .filter(Boolean)
                      .join(" · "),
                  );
                  setChassis(selected.chassisVin ?? "");
                }
              }}
            >
              <option value="">Enter vehicle details manually</option>
              {vehicles.map((item) => (
                <option value={item.id} key={item.id}>
                  {item.make} {item.model} ·{" "}
                  {[item.year, item.variant].filter(Boolean).join(" · ")}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="field-label">
          Car make & model
          <input
            required
            maxLength={100}
            dir="auto"
            placeholder="e.g. Toyota Axio"
            className="field-control"
            value={vehicle}
            onChange={(event) => {
              markDirty();
              setSelectedVehicleId("");
              setVehicle(event.target.value);
            }}
          />
        </label>
        <label className="field-label">
          Year & variant <small>Recommended</small>
          <input
            maxLength={50}
            placeholder="e.g. 2015, Hybrid G"
            className="field-control"
            value={year}
            onChange={(event) => {
              markDirty();
              setSelectedVehicleId("");
              setYear(event.target.value);
            }}
          />
        </label>
        <label className="field-label sm:col-span-2">
          Chassis / VIN (optional) <small>Helps identify exact compatibility</small>
          <input
            name="chassis"
            maxLength={80}
            placeholder="Enter if available"
            className="field-control"
            value={chassis}
            onChange={(event) => {
              markDirty();
              setSelectedVehicleId("");
              setChassis(event.target.value);
            }}
          />
        </label>
          </div>
        </section>

        <section className={`${stepClass(3)} sm:mt-8`} aria-labelledby="delivery-section-title">
          <div className="request-section-heading">
            <span>03</span>
            <div>
              <h3 id="delivery-section-title">Contact & delivery</h3>
              <p>Shared once for every part in this request.</p>
            </div>
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
        {state.mode === "fleet" && (
          <label className="field-label sm:col-span-2">
            Business / fleet name
            <input
              required
              maxLength={100}
              placeholder="Company or fleet name"
              className="field-control"
              value={business}
              onChange={(event) => {
                markDirty();
                setBusiness(event.target.value);
              }}
            />
          </label>
        )}
        {addresses.length > 0 && (
          <label className="field-label sm:col-span-2">
            Use a saved delivery address
            <select
              className="field-control select-control"
              value={selectedAddressId}
              onChange={(event) => {
                markDirty();
                setSelectedAddressId(event.target.value);
                const selected = addresses.find(
                  (address) => address.id === event.target.value,
                );
                if (selected) {
                  setArea(`${selected.area}, ${selected.city}`);
                  setPhone(selected.phone ?? customer?.phone ?? "");
                }
              }}
            >
              <option value="">Enter delivery details manually</option>
              {addresses.map((address) => (
                <option value={address.id} key={address.id}>
                  {address.label} · {address.area}, {address.city}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="field-label">
          Delivery area
          <input
            required
            maxLength={160}
            value={area}
            onChange={(event) => {
              markDirty();
              setSelectedAddressId("");
              setArea(event.target.value);
            }}
            placeholder="Area, city"
            className="field-control"
          />
        </label>
        <label className="field-label">
          Contact number
          <input
            type="tel"
            inputMode="tel"
            required
            pattern="\+[1-9][0-9]{7,14}"
            value={phone}
            onChange={(event) => {
              markDirty();
              setSelectedAddressId("");
              setPhone(event.target.value);
            }}
            placeholder="+8801XXXXXXXXX"
            className="field-control"
          />
        </label>
        <label className="field-label">
          How soon do you need it?
          <Select.Root value={urgency} onValueChange={setUrgency}>
            <Select.Trigger
              className="field-control flex items-center justify-between"
              aria-label="Urgency"
            >
              <Select.Value />
              <Select.Icon>
                <FiChevronDown aria-hidden="true" />
              </Select.Icon>
            </Select.Trigger>
            <Select.Portal>
              <Select.Content
                position="popper"
                className="z-[70] overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--surface)] p-1 shadow-xl"
              >
                <Select.Viewport>
                  {["Standard sourcing", "Urgent sourcing"].map((value) => (
                    <Select.Item
                      key={value}
                      value={value}
                      className="flex cursor-pointer items-center justify-between gap-4 rounded-md px-3 py-2 text-sm outline-none data-[highlighted]:bg-[var(--accent-soft)]"
                    >
                      <Select.ItemText>{value}</Select.ItemText>
                      <Select.ItemIndicator>
                        <FiCheck />
                      </Select.ItemIndicator>
                    </Select.Item>
                  ))}
                </Select.Viewport>
              </Select.Content>
            </Select.Portal>
          </Select.Root>
        </label>
        <label className="field-label">
          Request type
          <div className="field-control flex items-center text-sm text-[var(--muted-strong)]">
            {parts.length} {parts.length === 1 ? "part" : "parts"} · {totalPhotos} {totalPhotos === 1 ? "photo" : "photos"}
          </div>
        </label>
        <label className="field-label sm:col-span-2">
          Anything else we should know? <small>Optional · English or বাংলা</small>
          <textarea
            rows={2}
            maxLength={600}
            dir="auto"
            placeholder="Symptoms, preferred brand, several vehicles, or other details"
            className="field-control"
            value={notes}
            onChange={(event) => {
              markDirty();
              setNotes(event.target.value);
            }}
          />
        </label>
          </div>
        </section>
        {error && (
          <p
            className="mt-5 rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm font-semibold text-red-800 dark-error"
            role="alert"
            aria-live="assertive"
          >
            {error}
          </p>
        )}
      </div>

      <footer className="request-form-footer shrink-0 border-t border-[var(--line)] bg-[var(--surface)] px-5 py-3 pb-[max(12px,env(safe-area-inset-bottom))] sm:px-8 sm:py-5">
        <div className="flex items-center gap-3">
          {step > 1 && (
            <button
              type="button"
              className="secondary-button gap-2 sm:hidden"
              onClick={() => {
                setError("");
                setStep((value) => Math.max(1, value - 1));
              }}
            >
              <FiArrowLeft aria-hidden="true" /> Back
            </button>
          )}
          {step < 3 && (
            <ActionButton
              type="button"
              className="ml-auto sm:hidden"
              onClick={() => continueFrom(step)}
            >
              Continue <FiArrowRight className="ml-2" aria-hidden="true" />
            </ActionButton>
          )}
          <p className="hidden flex-1 text-xs leading-relaxed text-[var(--muted)] sm:block">
            Your request is sent securely. Photos remain private.
          </p>
          <ActionButton
            type="submit"
            className={step < 3 ? "max-sm:hidden" : "ml-auto sm:ml-0"}
            disabled={submitting}
          >
            {submitting ? "Submitting…" : "Submit Request"}
          </ActionButton>
        </div>
        <p className="mt-2 text-center text-[10px] text-[var(--muted)] sm:hidden">
          Your request is sent securely. Photos remain private.
        </p>
      </footer>

      {previewPhoto && (
        <div
          className="fixed inset-0 z-[80] grid place-items-center bg-[#020812e8] p-5"
          role="dialog"
          aria-modal="true"
          aria-label="Photo preview"
        >
          <button
            type="button"
            className="absolute right-4 top-4 grid size-11 place-items-center rounded-full bg-white text-[#071426]"
            onClick={() => setPreviewPhoto(null)}
            aria-label="Close photo preview"
          >
            <FiX size={20} />
          </button>
          <Image
            src={previewPhoto.previewUrl}
            alt="Selected part photo preview"
            width={1200}
            height={900}
            unoptimized
            className="max-h-[85dvh] max-w-full object-contain"
          />
        </div>
      )}
    </form>
  );
}

function Detail({ id }: { id: string }) {
  const { addPart, setDialog, catalogueProducts } = useSite();
  const product = catalogueProducts.find((item) => item.id === id);
  if (!product) return null;
  return (
    <>
      <Kicker>
        {product.category.name.toUpperCase()} · AVAILABLE CATALOGUE PART
      </Kicker>
      <Dialog.Title className="dialog-title">{product.name}</Dialog.Title>
      <Dialog.Description className="dialog-description">
        {product.description ??
          "An active catalogue product with current eligible supplier availability."}
      </Dialog.Description>
      <Image
        className="mt-5 h-52 w-full rounded-lg object-cover"
        src={
          product.imagePath ??
          product.category.imagePath ??
          "/assets/workshop-poster.webp"
        }
        alt={`${product.name} catalogue photograph`}
        width={960}
        height={416}
        unoptimized
      />
      <div className="mt-5 divide-y divide-[var(--line)] border-y border-[var(--line)]">
        {[
          [
            "Part number",
            product.numbers.find((item) => item.isPrimary)?.partNumber ??
              "Not published",
          ],
          [
            "Compatibility",
            product.compatibility.length
              ? product.compatibility
                  .map((item) => `${item.make} ${item.model}`)
                  .join(", ")
              : "Confirmed from vehicle details",
          ],
          [
            "Available offers",
            product.priceFrom
              ? `Fixed offers from ৳${product.priceFrom}${product.quoteBasedAvailable ? "; used quotes also available" : ""}`
              : "Used-part quotations available",
          ],
        ].map(([label, value]) => (
          <div key={label} className="flex justify-between gap-4 py-3 text-sm">
            <span className="text-[var(--muted)]">{label}</span>
            <b className="text-right">{value}</b>
          </div>
        ))}
      </div>
      <div className="mt-6 flex flex-wrap gap-3">
        <Link
          className="min-h-11 rounded-full bg-[#2478f2] px-5 py-3 text-sm font-bold text-white"
          href={`/parts/${product.id}`}
          onClick={() => setDialog(null)}
        >
          Compare supplier offers
        </Link>
        <button
          className="secondary-button"
          onClick={() => addPart(product.id)}
        >
          + Add to Parts Request
        </button>
      </div>
    </>
  );
}

function Basket() {
  const { basket, removePart, setDialog, catalogueProducts } = useSite();
  const items = basket
    .map((id) => catalogueProducts.find((product) => product.id === id))
    .filter((p): p is NonNullable<typeof p> => Boolean(p));
  return (
    <>
      <Kicker>MULTI-PART SOURCING</Kicker>
      <Dialog.Title className="dialog-title">Parts request.</Dialog.Title>
      <Dialog.Description className="dialog-description">
        Combine several items into one requirement for supplier sourcing.
      </Dialog.Description>
      {items.length ? (
        <>
          <div className="mt-6 divide-y divide-[var(--line)] border-y border-[var(--line)]">
            {items.map((item) => (
              <div
                className="flex items-center justify-between gap-3 py-4"
                key={item.id}
              >
                <div>
                  <small className="block font-bold text-[var(--accent)]">
                    {item.category.name}
                  </small>
                  <b className="text-sm">{item.name}</b>
                </div>
                <button
                  className="min-h-11 text-sm font-bold text-[var(--accent)] underline"
                  onClick={() => removePart(item.id)}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
          <ActionButton
            className="mt-6 w-full"
            onClick={() =>
              setDialog({ kind: "request", mode: "garage", fromBasket: true })
            }
          >
            Continue with vehicle details
          </ActionButton>
        </>
      ) : (
        <div className="mt-6 rounded-xl bg-[var(--surface-soft)] p-5 text-sm text-[var(--muted)]">
          No parts added yet. Browse frequently requested parts to build a
          combined request.
        </div>
      )}
    </>
  );
}

function Requests() {
  const { requests, setDialog } = useSite();
  return (
    <>
      <Kicker>YOUR SOURCING REQUESTS</Kicker>
      <Dialog.Title className="dialog-title">My requests.</Dialog.Title>
      <Dialog.Description className="dialog-description">
        These requests are stored by PartsArc and restored with your session.
      </Dialog.Description>
      <div className="mt-6 space-y-3">
        {requests.length ? (
          requests.map((item) => (
            <div
              key={item.reference}
              className="rounded-lg border border-[var(--line)] p-4"
            >
              <b className="block">{item.part}</b>
              <small className="mt-1 block text-[var(--muted)]">
                {item.reference} · {item.vehicle} · {item.urgency}
              </small>
              <small className="mt-1 block font-bold text-[var(--accent)]">
                {item.status}
              </small>
            </div>
          ))
        ) : (
          <p className="rounded-lg bg-[var(--surface-soft)] p-5 text-sm text-[var(--muted)]">
            No sourcing requests yet.
          </p>
        )}
      </div>
      <ActionButton
        className="mt-6"
        onClick={() => setDialog({ kind: "request", mode: "standard" })}
      >
        Start a parts request
      </ActionButton>
    </>
  );
}

function Info({
  topic,
}: {
  topic: Extract<DialogState, { kind: "info" }>["topic"];
}) {
  const { categories } = useSite();
  const info = {
    contact: [
      "Contact PartArc",
      "Official support phone, email, and operating hours will be published before service launch. This preview does not contact a supplier.",
    ],
    coverage: [
      "Service areas",
      "Priority-delivery eligibility depends on location, supplier availability, distance, traffic and operating coverage. No live area check is available in this preview.",
    ],
    terms: [
      "Terms & privacy",
      "Formal terms, privacy information, quotation validity, returns and delivery policies need review and publication before launch.",
    ],
    credits: [
      "Photography credits",
      "Photography and footage sources are listed below. Verify rights before public launch.",
    ],
  } as const;
  return (
    <>
      <Kicker>SUPPORT</Kicker>
      <Dialog.Title className="dialog-title">{info[topic][0]}</Dialog.Title>
      <Dialog.Description className="dialog-description">
        {info[topic][1]}
      </Dialog.Description>
      {topic === "credits" && (
        <div className="mt-6 flex flex-col gap-3 text-sm text-[var(--accent)]">
          {categories
            .filter((category) => categoryCredits[category.slug])
            .map((category) => (
              <a
                key={category.id}
                className="underline"
                href={categoryCredits[category.slug]}
                target="_blank"
                rel="noreferrer"
              >
                {category.name} photograph source{" "}
                <FiArrowUpRight className="inline" />
              </a>
            ))}
          <a
            className="underline"
            href="https://www.pexels.com/video/close-up-shot-of-a-mechanic-repairing-a-vehicle-7565185/"
            target="_blank"
            rel="noreferrer"
          >
            Hero workshop footage <FiArrowUpRight className="inline" />
          </a>
          <a
            className="underline"
            href="https://www.pexels.com/photo/man-in-red-crew-neck-t-shirt-sitting-on-a-motorcycle-holding-a-carton-box-6867968/"
            target="_blank"
            rel="noreferrer"
          >
            Emergency photograph <FiArrowUpRight className="inline" />
          </a>
          <a
            className="underline"
            href="https://www.pexels.com/photo/auto-mechanics-at-work-7018506/"
            target="_blank"
            rel="noreferrer"
          >
            Workshop photograph <FiArrowUpRight className="inline" />
          </a>
        </div>
      )}
    </>
  );
}

export function SiteDialog() {
  const { dialog, setDialog, openDashboard } = useSite();
  const [requestDirty, setRequestDirty] = useState(false);
  const requestOpen = dialog?.kind === "request";

  function closeDialog() {
    if (
      requestOpen &&
      requestDirty &&
      !window.confirm("Discard this unfinished parts request?")
    ) {
      return;
    }
    setRequestDirty(false);
    setDialog(null);
  }

  return (
    <Dialog.Root
      open={dialog !== null}
      onOpenChange={(open) => {
        if (!open) closeDialog();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-[#03101f]/80 data-[state=open]:animate-[fadeIn_.2s_ease]" />
        <Dialog.Content
          className={
            requestOpen
              ? "dialog-surface fixed inset-0 z-[60] flex h-dvh w-full flex-col overflow-hidden rounded-none shadow-2xl focus:outline-none sm:left-1/2 sm:top-1/2 sm:h-auto sm:max-h-[88vh] sm:w-[min(92vw,880px)] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-3xl"
              : `dialog-surface fixed left-1/2 top-1/2 z-[60] max-h-[min(90vh,900px)] w-[min(92vw,680px)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl p-6 shadow-2xl focus:outline-none sm:p-9 ${dialog?.kind === "auth" ? "max-w-[510px]" : ""}`
          }
        >
          <Dialog.Close
            className="absolute right-4 top-4 z-10 grid size-11 place-items-center rounded-full bg-[var(--surface-soft)] hover:bg-[var(--surface-raised)]"
            aria-label="Close dialog"
          >
            <FiX size={20} />
          </Dialog.Close>
          {requestOpen && (
            <RequestForm
              key={`${dialog.mode}-${dialog.part ?? ""}-${dialog.area ?? ""}-${dialog.fromBasket ?? ""}`}
              state={dialog}
              onDirtyChange={setRequestDirty}
            />
          )}
          {!requestOpen && <div className="pr-8">
            {dialog?.kind === "auth" && (
              <AuthForm key={dialog.mode} initialMode={dialog.mode} />
            )}
            {dialog?.kind === "detail" && <Detail id={dialog.productId} />}
            {dialog?.kind === "basket" && <Basket />}
            {dialog?.kind === "requests" && <Requests />}
            {dialog?.kind === "info" && <Info topic={dialog.topic} />}
            {dialog?.kind === "success" && (
              <>
                <Kicker>REQUEST SUBMITTED</Kicker>
                <Dialog.Title className="dialog-title">
                  Your request is saved.
                </Dialog.Title>
                <Dialog.Description className="dialog-description">
                  PartsArc operations can now review and assign this request.
                </Dialog.Description>
                <div className="mt-6 rounded-xl bg-[var(--surface-soft)] p-5">
                  <b className="block font-heading text-xl text-[var(--accent)]">
                    {dialog.request.reference}
                  </b>
                  <p className="mt-2 text-sm">{dialog.request.part}</p>
                  <p className="mt-1 text-sm text-[var(--muted)]">
                    {dialog.request.vehicle} · {dialog.request.area}
                  </p>
                </div>
                <p className="mt-5 text-sm text-[var(--muted)]">
                  Any attached photo is stored privately and is available only
                  through authorized request access.
                </p>
                <ActionButton
                  className="mt-6"
                  onClick={() => openDashboard("requests")}
                >
                  View My Requests
                </ActionButton>
              </>
            )}
          </div>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
