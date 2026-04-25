import { ButtonHTMLAttributes, ReactNode } from 'react';

type Variant = 'primary' | 'ghost' | 'danger' | 'upload';
type Props = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; children: ReactNode };

const styles: Record<Variant, string> = {
  primary: 'bg-amber text-bg-3 hover:bg-amber-dark font-display tracking-wider uppercase',
  ghost: 'bg-transparent text-text-dim border border-border-slate hover:border-amber hover:text-amber',
  danger: 'bg-transparent text-danger border border-danger-muted hover:bg-danger-muted/30',
  upload: 'bg-gradient-to-br from-amber to-amber-dark text-bg-3 shadow-lg shadow-amber/30 font-display tracking-wider uppercase',
};

export function Button({ variant = 'primary', className = '', children, ...rest }: Props) {
  return (
    <button {...rest} className={`px-4 py-2.5 rounded-md font-semibold text-sm transition-colors ${styles[variant]} ${className}`}>
      {children}
    </button>
  );
}
