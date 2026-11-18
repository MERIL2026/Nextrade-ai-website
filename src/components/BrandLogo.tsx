import React from 'react';

interface BrandLogoProps {
  variant?: 'dark' | 'light';
  showWordmark?: boolean;
  className?: string;
  symbolHeightClass?: string;
}

export const BrandLogo: React.FC<BrandLogoProps> = ({
  variant = 'dark',
  showWordmark = true,
  className = '',
  symbolHeightClass = 'h-5',
}) => {
  const symbolSrc =
    variant === 'dark'
      ? '/assets/aistudio/03-symbol-white_ae2e5c8b.svg'
      : '/assets/aistudio/04-symbol-black_2ad61c4e.svg';

  const textColor = variant === 'dark' ? 'text-[#F5F7FA]' : 'text-[#080B12]';

  return (
    <span className={`inline-flex items-center gap-2.5 select-none ${className}`}>
      <img
        src={symbolSrc}
        alt="Nextrade AI mark"
        className={`${symbolHeightClass} w-auto object-contain shrink-0`}
        referrerPolicy="no-referrer"
      />
      {showWordmark && (
        <span
          className={`font-display text-[15px] font-bold tracking-[0.06em] whitespace-nowrap shrink-0 ${textColor}`}
        >
          NEXTRADE AI
        </span>
      )}
    </span>
  );
};
