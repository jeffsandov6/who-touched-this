type EmptyThoughtProps = {
  label: string;
};

export default function EmptyThought({ label }: EmptyThoughtProps) {
  return (
    <div className="drunk-thought drunk-thought--empty">
      <span className="drunk-thought--empty__arrow" aria-hidden="true">
        ▸
      </span>
      <span>{label}</span>
    </div>
  );
}