import { forwardRef } from 'react';

interface TextInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  error?: boolean;
}

export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(
  ({ className = '', error, ...props }, ref) => {
    return (
      <input
        ref={ref}
        className={[
          'w-full px-2.5 py-1.5 bg-white border rounded-md text-[13px] text-[#333333]',
          'focus:outline-none focus:border-[#0063E1] focus:ring-2 focus:ring-[#0063E1]/20',
          'placeholder:text-[#999999]',
          'disabled:opacity-40 disabled:cursor-not-allowed',
          'transition-colors duration-150',
          error ? 'border-[#FF3B30]' : 'border-[#E5E5E5]',
          className,
        ].join(' ')}
        {...props}
      />
    );
  },
);

TextInput.displayName = 'TextInput';

interface TextAreaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  error?: boolean;
}

export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(
  ({ className = '', error, ...props }, ref) => {
    return (
      <textarea
        ref={ref}
        className={[
          'w-full px-2.5 py-1.5 bg-white border rounded-md text-[13px] text-[#333333]',
          'focus:outline-none focus:border-[#0063E1] focus:ring-2 focus:ring-[#0063E1]/20',
          'placeholder:text-[#999999]',
          'disabled:opacity-40 disabled:cursor-not-allowed',
          'transition-colors duration-150',
          'resize-none',
          error ? 'border-[#FF3B30]' : 'border-[#E5E5E5]',
          className,
        ].join(' ')}
        {...props}
      />
    );
  },
);

TextArea.displayName = 'TextArea';
