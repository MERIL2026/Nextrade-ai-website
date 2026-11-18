import React, { createContext, useContext } from 'react';
import { motion } from 'motion/react';
import { ArrowRight, ChevronRight, Info } from 'lucide-react';
import { Navbar } from './Navbar';
import { SiteFooter } from './FaqAndFooter';
import { FINTECH_EASE, FINTECH_SPRING_SNAPPY } from '../lib/motionPrimitives';
import { BreadcrumbItem, getBreadcrumbsForPath } from '../lib/siteData';

interface ShellContextValue {
  currentPath: string;
  onNavigate?: (path: string) => void;
}

const ShellContext = createContext<ShellContextValue>({
  currentPath: '/',
});

interface BreadcrumbsProps {
  items: BreadcrumbItem[];
  onNavigate?: (path: string) => void;
  centered?: boolean;
}

export const Breadcrumbs: React.FC<BreadcrumbsProps> = ({
  items,
  onNavigate,
  centered = false,
}) => {
  if (!items || items.length === 0) return null;

  return (
    <nav
      aria-label="Breadcrumb"
      className={centered ? 'flex justify-center' : 'flex justify-start'}
    >
      <ol className="flex flex-wrap items-center gap-1.5 text-xs text-[#667085]">
        {items.map((item, idx) => {
          const isLast = idx === items.length - 1;
          return (
            <li key={`${item.label}-${idx}`} className="inline-flex items-center gap-1.5">
              {idx > 0 && (
                <ChevronRight
                  className="h-3.5 w-3.5 text-[#98A2B3] shrink-0"
                  aria-hidden="true"
                />
              )}
              {item.href && !isLast ? (
                <a
                  href={item.href}
                  onClick={(e) => {
                    if (onNavigate) {
                      e.preventDefault();
                      onNavigate(item.href!);
                    }
                  }}
                  className="font-medium text-[#667085] hover:text-[#2D46E6] transition-colors"
                >
                  {item.label}
                </a>
              ) : (
                <span
                  aria-current={isLast ? 'page' : undefined}
                  className={isLast ? 'font-semibold text-[#080B12]' : 'font-medium text-[#667085]'}
                >
                  {item.label}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
};

interface SitePageShellProps {
  currentPath: string;
  onNavigate: (path: string) => void;
  children: React.ReactNode;
}

export const SitePageShell: React.FC<SitePageShellProps> = ({
  currentPath,
  onNavigate,
  children,
}) => {
  return (
    <ShellContext.Provider value={{ currentPath, onNavigate }}>
      <div className="min-h-screen flex flex-col bg-[#FFFFFF] text-[#080B12]">
        <Navbar onNavigate={onNavigate} currentPath={currentPath} />
        <main className="flex-1">{children}</main>
        <SiteFooter onNavigate={onNavigate} />
      </div>
    </ShellContext.Provider>
  );
};

interface PageHeaderBandProps {
  eyebrow: string;
  title: string;
  description: string;
  variant?: 'left' | 'centered' | 'split';
  aside?: React.ReactNode;
  breadcrumbs?: BreadcrumbItem[];
  primaryCta?: { label: string; onClick: () => void };
  secondaryCta?: { label: string; href?: string; onClick?: () => void };
}

export const PageHeaderBand: React.FC<PageHeaderBandProps> = ({
  eyebrow,
  title,
  description,
  variant = 'left',
  aside,
  breadcrumbs,
  primaryCta,
  secondaryCta,
}) => {
  const { currentPath, onNavigate } = useContext(ShellContext);
  const resolvedBreadcrumbs =
    breadcrumbs ?? (currentPath !== '/' ? getBreadcrumbsForPath(currentPath) : []);

  if (variant === 'centered') {
    return (
      <section className="border-b border-[#E4E8F2] bg-[#FFFFFF] py-16 sm:py-20">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.36, ease: FINTECH_EASE }}
          className="mx-auto max-w-[900px] px-4 sm:px-6 lg:px-8 text-center space-y-5"
        >
          {resolvedBreadcrumbs.length > 1 && (
            <Breadcrumbs items={resolvedBreadcrumbs} onNavigate={onNavigate} centered />
          )}
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[#2D46E6]">
            {eyebrow}
          </p>
          <h1 className="font-display text-3xl sm:text-5xl font-bold tracking-[-0.03em] text-[#080B12] text-balance leading-[1.08]">
            {title}
          </h1>
          <p className="mx-auto max-w-2xl text-base sm:text-lg leading-relaxed text-[#667085]">
            {description}
          </p>
          {(primaryCta || secondaryCta) && (
            <div className="pt-2 flex flex-wrap items-center justify-center gap-3">
              {primaryCta && (
                <motion.button
                  type="button"
                  whileHover={{ y: -1.5 }}
                  whileTap={{ scale: 0.98 }}
                  transition={FINTECH_SPRING_SNAPPY}
                  onClick={primaryCta.onClick}
                  className="inline-flex h-11 items-center gap-2 rounded-md bg-[#2D46E6] px-6 text-xs font-semibold uppercase tracking-[0.04em] text-[#FFFFFF] shadow-[0_8px_20px_rgba(45,70,230,0.22)] hover:bg-[#2238C9] transition-colors cursor-pointer"
                >
                  <span>{primaryCta.label}</span>
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </motion.button>
              )}
              {secondaryCta &&
                (secondaryCta.href ? (
                  <a
                    href={secondaryCta.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex h-11 items-center gap-2 rounded-md border border-[#E4E8F2] bg-[#FFFFFF] px-5 text-xs font-semibold uppercase tracking-[0.03em] text-[#080B12] hover:border-[#2D46E6] hover:text-[#2D46E6] transition-colors"
                  >
                    {secondaryCta.label}
                  </a>
                ) : (
                  <button
                    type="button"
                    onClick={secondaryCta.onClick}
                    className="inline-flex h-11 items-center gap-2 rounded-md border border-[#E4E8F2] bg-[#FFFFFF] px-5 text-xs font-semibold uppercase tracking-[0.03em] text-[#080B12] hover:border-[#2D46E6] hover:text-[#2D46E6] transition-colors cursor-pointer"
                  >
                    {secondaryCta.label}
                  </button>
                ))}
            </div>
          )}
        </motion.div>
      </section>
    );
  }

  return (
    <section className="border-b border-[#E4E8F2] bg-[#FFFFFF] py-14 sm:py-20">
      <div className="mx-auto max-w-[1200px] px-4 sm:px-6 lg:px-8">
        <div
          className={
            variant === 'split' && aside
              ? 'grid grid-cols-1 lg:grid-cols-12 gap-10 items-center'
              : 'max-w-3xl'
          }
        >
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.36, ease: FINTECH_EASE }}
            className={variant === 'split' && aside ? 'lg:col-span-7 space-y-5' : 'space-y-5'}
          >
            {resolvedBreadcrumbs.length > 1 && (
              <Breadcrumbs items={resolvedBreadcrumbs} onNavigate={onNavigate} />
            )}
            <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[#2D46E6]">
              {eyebrow}
            </p>
            <h1 className="font-display text-3xl sm:text-5xl font-bold tracking-[-0.03em] text-[#080B12] text-balance leading-[1.08]">
              {title}
            </h1>
            <p className="max-w-2xl text-base sm:text-lg leading-relaxed text-[#667085]">
              {description}
            </p>
            {(primaryCta || secondaryCta) && (
              <div className="pt-2 flex flex-wrap items-center gap-3">
                {primaryCta && (
                  <motion.button
                    type="button"
                    whileHover={{ y: -1.5 }}
                    whileTap={{ scale: 0.98 }}
                    transition={FINTECH_SPRING_SNAPPY}
                    onClick={primaryCta.onClick}
                    className="inline-flex h-11 items-center gap-2 rounded-md bg-[#2D46E6] px-6 text-xs font-semibold uppercase tracking-[0.04em] text-[#FFFFFF] shadow-[0_8px_20px_rgba(45,70,230,0.22)] hover:bg-[#2238C9] transition-colors cursor-pointer"
                  >
                    <span>{primaryCta.label}</span>
                    <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </motion.button>
                )}
                {secondaryCta &&
                  (secondaryCta.href ? (
                    <a
                      href={secondaryCta.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex h-11 items-center gap-2 rounded-md border border-[#E4E8F2] bg-[#FFFFFF] px-5 text-xs font-semibold uppercase tracking-[0.03em] text-[#080B12] hover:border-[#2D46E6] hover:text-[#2D46E6] transition-colors"
                    >
                      {secondaryCta.label}
                    </a>
                  ) : (
                    <button
                      type="button"
                      onClick={secondaryCta.onClick}
                      className="inline-flex h-11 items-center gap-2 rounded-md border border-[#E4E8F2] bg-[#FFFFFF] px-5 text-xs font-semibold uppercase tracking-[0.03em] text-[#080B12] hover:border-[#2D46E6] hover:text-[#2D46E6] transition-colors cursor-pointer"
                    >
                      {secondaryCta.label}
                    </button>
                  ))}
              </div>
            )}
          </motion.div>

          {variant === 'split' && aside && (
            <motion.div
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.42, delay: 0.06, ease: FINTECH_EASE }}
              className="lg:col-span-5"
            >
              {aside}
            </motion.div>
          )}
        </div>
      </div>
    </section>
  );
};

interface DisclosureNoticeProps {
  label: string;
  text: string;
}

export const DisclosureNotice: React.FC<DisclosureNoticeProps> = ({ label, text }) => (
  <motion.div
    initial={{ opacity: 0, y: 8 }}
    whileInView={{ opacity: 1, y: 0 }}
    viewport={{ once: true, amount: 0.2 }}
    transition={{ duration: 0.3, ease: FINTECH_EASE }}
    className="rounded-lg border border-[#E4E8F2] bg-[#F7F8FA] px-4 py-3 flex items-start gap-3 text-xs leading-relaxed text-[#667085]"
  >
    <Info className="h-4 w-4 text-[#2D46E6] shrink-0 mt-0.5" aria-hidden="true" />
    <div>
      <span className="font-semibold text-[#080B12]">{label}: </span>
      <span>{text}</span>
    </div>
  </motion.div>
);
