type Props = {
  paths: string[];
  selectedIdx: number;
  onSelect: (i: number) => void;
};

export function ThumbnailPicker({ paths, selectedIdx, onSelect }: Props) {
  return (
    <div className="grid grid-cols-6 gap-2">
      {paths.map((p, i) => (
        <button
          key={p}
          onClick={() => onSelect(i)}
          className={`aspect-video rounded overflow-hidden border-2 ${
            i === selectedIdx ? 'border-amber shadow-lg shadow-amber/20' : 'border-transparent'
          }`}
          aria-label={`Thumbnail ${i + 1}${i === selectedIdx ? ' (selected)' : ''}`}
        >
          <img src={`file://${p}`} alt="" className="w-full h-full object-cover" />
        </button>
      ))}
    </div>
  );
}
