import { forwardRef } from 'react';
import { ChevronDown } from 'lucide-react';

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  options?: { value: string; label: string }[];
  error?: boolean;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ className = '', options, children, error, ...props }, ref) => {
    return (
      <div className="relative">
        <select
          ref={ref}
          className={[
            'w-full appearance-none bg-white border rounded-md pl-2.5 pr-8 py-1.5 text-[13px] text-[#333333]',
            'focus:outline-none focus:border-[#0063E1] focus:ring-2 focus:ring-[#0063E1]/20',
            'disabled:opacity-40 disabled:cursor-not-allowed',
            'transition-colors duration-150',
            error ? 'border-[#FF3B30]' : 'border-[#E5E5E5]',
            className,
          ].join(' ')}
          {...props}
        >
          {options
            ? options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))
            : children}
        </select>
        <ChevronDown
          size={14}
          className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[#999999]"
        />
      </div>
    );
  },
);

Select.displayName = 'Select';
