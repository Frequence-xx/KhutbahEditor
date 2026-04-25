type Props = { className?: string };
export function Logo({ className = 'h-8 w-auto' }: Props) {
  return <img src="/logo.png" alt="Al-Himmah" className={className} />;
}
