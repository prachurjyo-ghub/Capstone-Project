"use client";

import { useState, type ChangeEvent, type FormEvent } from "react";
import { FiCamera, FiCheck, FiUser } from "react-icons/fi";
import { saveMechanicProfile, type Mechanic } from "./workspace-state";

export function MechanicProfile({ mechanic }: { mechanic: Mechanic }) {
  const [photo, setPhoto] = useState<string | undefined>();
  const [removePhoto, setRemovePhoto] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [reading, setReading] = useState(false);
  const currentPhoto = removePhoto ? undefined : photo ?? mechanic.photo;

  function selectPhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    if (!["image/jpeg", "image/png"].includes(file.type) || file.size > 512 * 1024) {
      setError("Choose a JPG or PNG photo up to 512 KiB.");
      return;
    }
    const reader = new FileReader();
    setReading(true);
    reader.onload = () => { setPhoto(String(reader.result)); setRemovePhoto(false); setReading(false); };
    reader.onerror = () => { setError("Could not read this photo."); setReading(false); };
    setError("");
    setMessage("");
    reader.readAsDataURL(file);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name")).trim();
    if (!name) {
      setError("Enter your name.");
      return;
    }
    const saved = await saveMechanicProfile({
      name, email: String(form.get("email")).trim(),
      phone: String(form.get("phone")).trim(), specialty: String(form.get("specialty")).trim(), photo: currentPhoto ?? null,
    });
    setError("");
    if (saved) setMessage("Profile saved.");
  }

  return (
    <form className="panel profile-form mechanic-profile stack-form" onSubmit={submit} onChange={() => setMessage("")}>
      <div className="profile-identity">
        <span className="avatar profile-avatar">{currentPhoto ? <img src={currentPhoto} alt="Your profile" /> : <FiUser aria-hidden="true" />}</span>
        <div><h2>{mechanic.name}</h2><p className="muted">@{mechanic.username}</p></div>
        <div className="profile-photo-actions">
          <label className="button secondary photo-picker"><FiCamera aria-hidden="true" /> Choose photo<input type="file" aria-label="Choose profile photo" accept="image/jpeg,image/png" onChange={selectPhoto} /></label>
          {currentPhoto && <button className="button secondary" type="button" onClick={() => { setRemovePhoto(true); setPhoto(undefined); setMessage(""); }}>Remove photo</button>}
        </div>
      </div>
      <div className="form-grid">
        <label>Full name<input name="name" defaultValue={mechanic.name} required /></label>
        <label>Email<input name="email" type="email" defaultValue={mechanic.email} required /></label>
        <label>Phone<input name="phone" type="tel" defaultValue={mechanic.phone} /></label>
        <label>Specialty<input name="specialty" defaultValue={mechanic.specialty} placeholder="e.g. Brake systems" /></label>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="form-actions">
        <button className="button primary" type="submit" disabled={reading}>Save profile</button>
        {message && <span className="success-text" role="status"><FiCheck aria-hidden="true" /> {message}</span>}
      </div>
    </form>
  );
}
