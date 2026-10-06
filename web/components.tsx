import {
  useEffect,
  useRef,
  type ReactNode,
  type ButtonHTMLAttributes,
} from "react";
import {
  X,
  FileText,
  UserRound,
  ShieldCheck,
  LoaderCircle,
} from "lucide-react";
import type { Audit } from "./api";
export function Button({
  children,
  busy,
  secondary = false,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  busy?: boolean;
  secondary?: boolean;
}) {
  return (
    <button
      {...props}
      className={`${secondary ? "button secondary" : "button"} ${props.className ?? ""}`}
      disabled={props.disabled || busy}
    >
      {busy && <LoaderCircle className="spin" size={16} />}
      {children}
    </button>
  );
}
export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <div className="modal-top">
        <h2>{title}</h2>
        <button
          className="icon-button"
          aria-label="Close dialog"
          onClick={onClose}
        >
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function Activity({
  items,
  full = false,
}: {
  items: Audit[];
  full?: boolean;
}) {
  if (!items.length)
    return (
      <div className="activity-empty">
        <FileText size={28} />
        <strong>No activity yet</strong>
        <p>Login results appear here. Credentials never do.</p>
      </div>
    );
  return (
    <div className="activity-list">
      {items.slice(0, full ? 100 : 5).map((a) => (
        <div className="event" key={a.id}>
          <ShieldCheck size={19} />
          <div>
            <strong>{a.action.replace(/_/g, " ")}</strong>
            <small>
              {a.site ?? "Broker"}
              {a.reason && ` · ${a.reason.replace(/_/g, " ").toLowerCase()}`}
            </small>
          </div>
          <div className="event-end">
            <span className={`result ${a.status.toLowerCase()}`}>
              {a.status.toLowerCase()}
            </span>
            <time>
              {new Date(a.at).toLocaleTimeString([], {
                hour: "numeric",
                minute: "2-digit",
              })}
            </time>
          </div>
        </div>
      ))}
    </div>
  );
}
export function AccountEmpty({ onDemo }: { onDemo: () => void }) {
  return (
    <div className="account-empty">
      <UserRound size={36} strokeWidth={1.7} />
      <h3>Your accounts belong here</h3>
      <p>Enroll a website to enable session renewal and MFA.</p>
      <button className="text-button" onClick={onDemo}>
        Try the local demo
      </button>
    </div>
  );
}
