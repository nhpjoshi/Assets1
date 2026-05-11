// src/components/Button.jsx

export default function Button({ label, onClick, variant = 'neutral' }) {
  const className = `btn btn-${variant}`;
  return (
    <button className={className} onClick={onClick}>
      {label}
    </button>
  );
}