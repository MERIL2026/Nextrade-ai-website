import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Menu, X, ChevronDown, ArrowUpRight, User, Shield, LogOut } from 'lucide-react';
import { BrandLogo } from './BrandLogo';
import { NAV_GROUPS } from '../lib/siteData';
import { useAuth } from '../lib/authContext';
import {
  FINTECH_EASE,
  FINTECH_SPRING_SNAPPY,
  ScrollProgressBar,
} from '../lib/motionPrimitives';

interface NavbarProps {
  onNavigate: (path: string) => void;
  currentPath: string;
}

export const Navbar: React.FC<NavbarProps> = ({ onNavigate, currentPath }) => {
  const { status, user, logout } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [mobileExpandedGroup, setMobileExpandedGroup] = useState<string | null>('product');
  const headerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const onPointerDown = (e: MouseEvent) => {
      if (headerRef.current && !headerRef.current.contains(e.target as Node)) {
        setOpenDropdown(null);
        setAccountMenuOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpenDropdown(null);
        setAccountMenuOpen(false);
        setMobileOpen(false);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  const handleRouteNavigate = (href: string, external?: boolean) => {
    setOpenDropdown(null);
    setAccountMenuOpen(false);
    setMobileOpen(false);
    if (external) return;
    onNavigate(href);
  };

  const handleLogout = async () => {
    setAccountMenuOpen(false);
    setMobileOpen(false);
    await logout();
    onNavigate('/');
  };

  return (
    <motion.header
      ref={headerRef}
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: FINTECH_EASE }}
      className="sticky top-0 z-50 border-b border-[#E4E8F2] bg-[#FFFFFF]/92 backdrop-blur-md"
    >
      <ScrollProgressBar />
      <div className="mx-auto flex h-16 max-w-[1200px] items-center justify-between gap-6 px-4 sm:px-6 lg:px-8">
        {/* Zone 1: Brand Lockup (strictly black symbol on light surface) */}
        <a
          href="/"
          onClick={(e) => {
            e.preventDefault();
            setOpenDropdown(null);
            setMobileOpen(false);
            onNavigate('/');
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }}
          className="inline-flex items-center whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#2D46E6] rounded-sm"
          aria-label="Nextrade AI Home"
        >
          <BrandLogo variant="light" symbolHeightClass="h-4.5" />
        </a>

        {/* Zone 2: Grouped Desktop Dropdown Navigation */}
        <nav
          aria-label="Primary navigation"
          className="hidden md:flex items-center gap-2 lg:gap-4 text-[13px] font-medium text-[#667085]"
        >
          {NAV_GROUPS.map((group) => {
            const isOpen = openDropdown === group.id;
            const hasActiveChild = group.items.some(
              (item) => !item.external && item.href === currentPath,
            );

            return (
              <div
                key={group.id}
                className="relative"
                onMouseEnter={() => setOpenDropdown(group.id)}
                onMouseLeave={() => setOpenDropdown((prev) => (prev === group.id ? null : prev))}
              >
                <button
                  type="button"
                  aria-expanded={isOpen}
                  aria-haspopup="menu"
                  onClick={() => setOpenDropdown(isOpen ? null : group.id)}
                  className={`inline-flex items-center gap-1 rounded-md px-3 py-2 text-[13px] transition-colors cursor-pointer whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2D46E6] ${
                    isOpen || hasActiveChild
                      ? 'text-[#080B12] font-semibold bg-[#F7F8FA]'
                      : 'text-[#667085] hover:text-[#080B12]'
                  }`}
                >
                  <span>{group.label}</span>
                  <ChevronDown
                    className={`h-3.5 w-3.5 transition-transform duration-150 ${
                      isOpen ? 'rotate-180 text-[#2D46E6]' : ''
                    }`}
                    aria-hidden="true"
                  />
                </button>

                <AnimatePresence>
                  {isOpen && (
                    <motion.div
                      initial={{ opacity: 0, y: 6, scale: 0.985 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: 4, scale: 0.985 }}
                      transition={FINTECH_SPRING_SNAPPY}
                      role="menu"
                      aria-label={`${group.label} menu`}
                      className="absolute left-0 top-full pt-2 w-64 z-50 origin-top-left"
                    >
                      <div className="rounded-xl border border-[#E4E8F2] bg-[#FFFFFF] p-2 shadow-[0_18px_44px_rgba(15,23,42,0.1)]">
                        {group.items.map((item) => {
                          const isActive = !item.external && currentPath === item.href;
                          if (item.external) {
                            return (
                              <a
                                key={item.label}
                                role="menuitem"
                                href={item.href}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={() => setOpenDropdown(null)}
                                className="flex items-start justify-between gap-2 rounded-lg px-3 py-2.5 text-left hover:bg-[#F7F8FA] transition-colors group"
                              >
                                <div>
                                  <div className="text-[13px] font-semibold text-[#080B12] group-hover:text-[#2D46E6] flex items-center gap-1">
                                    <span>{item.label}</span>
                                    <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
                                  </div>
                                  {item.description && (
                                    <div className="text-[11.5px] text-[#667085]">
                                      {item.description}
                                    </div>
                                  )}
                                </div>
                              </a>
                            );
                          }

                          return (
                            <a
                              key={item.label}
                              role="menuitem"
                              href={item.href}
                              onClick={(e) => {
                                e.preventDefault();
                                handleRouteNavigate(item.href);
                              }}
                              className={`block rounded-lg px-3 py-2.5 text-left transition-colors ${
                                isActive
                                  ? 'bg-[#EFF2FA] text-[#2D46E6]'
                                  : 'hover:bg-[#F7F8FA] text-[#080B12]'
                              }`}
                            >
                              <div className="text-[13px] font-semibold">{item.label}</div>
                              {item.description && (
                                <div className="text-[11.5px] text-[#667085]">{item.description}</div>
                              )}
                            </a>
                          );
                        })}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </nav>

        {/* Zone 3: Auth & Primary CTA */}
        <div className="hidden md:flex items-center gap-2.5 shrink-0">
          {status === 'authenticated' && user ? (
            <div className="relative">
              <button
                type="button"
                aria-expanded={accountMenuOpen}
                aria-haspopup="menu"
                onClick={() => setAccountMenuOpen((prev) => !prev)}
                className="inline-flex h-9 items-center gap-2 rounded-md border border-[#E4E8F2] bg-[#F7F8FA] px-3 text-[13px] font-medium text-[#080B12] hover:border-[#2D46E6] transition-colors cursor-pointer whitespace-nowrap"
              >
                <User className="h-3.5 w-3.5 text-[#2D46E6]" aria-hidden="true" />
                <span className="max-w-[130px] truncate">{user.fullName}</span>
                <ChevronDown className="h-3.5 w-3.5 text-[#667085]" aria-hidden="true" />
              </button>

              {accountMenuOpen && (
                <div
                  role="menu"
                  aria-label="Account menu"
                  className="absolute right-0 top-full mt-2 w-60 rounded-xl border border-[#E4E8F2] bg-[#FFFFFF] p-2 shadow-[0_18px_44px_rgba(15,23,42,0.1)] z-50"
                >
                  <div className="border-b border-[#E4E8F2] px-3 py-2 mb-1">
                    <div className="text-xs font-semibold text-[#080B12] truncate">{user.fullName}</div>
                    <div className="text-[11px] text-[#667085] truncate">{user.email}</div>
                  </div>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => handleRouteNavigate('/app')}
                    className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-medium text-[#080B12] hover:bg-[#F7F8FA] cursor-pointer"
                  >
                    <span>Open Workspace</span>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => handleRouteNavigate('/app/account')}
                    className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-medium text-[#080B12] hover:bg-[#F7F8FA] cursor-pointer"
                  >
                    <User className="h-3.5 w-3.5 text-[#667085]" aria-hidden="true" />
                    <span>Account Settings</span>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => handleRouteNavigate('/app/security')}
                    className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-medium text-[#080B12] hover:bg-[#F7F8FA] cursor-pointer"
                  >
                    <Shield className="h-3.5 w-3.5 text-[#667085]" aria-hidden="true" />
                    <span>Security &amp; Sessions</span>
                  </button>
                  <div className="border-t border-[#E4E8F2] mt-1 pt-1">
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => void handleLogout()}
                      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-semibold text-[#DC2626] hover:bg-[#FEF2F2] cursor-pointer"
                    >
                      <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Sign Out</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <button
              type="button"
              onClick={() => handleRouteNavigate('/login')}
              className="inline-flex items-center justify-center rounded-md border border-[#E4E8F2] bg-[#FFFFFF] px-3.5 py-2 text-[13px] font-semibold text-[#080B12] hover:border-[#2D46E6] hover:text-[#2D46E6] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Sign In
            </button>
          )}

          <motion.button
            type="button"
            whileHover={{ y: -1 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => handleRouteNavigate('/app')}
            className="inline-flex items-center justify-center rounded-md bg-[#2D46E6] px-4 py-2 text-[13px] font-semibold text-[#FFFFFF] shadow-[0_6px_18px_rgba(45,70,230,0.22)] transition-colors duration-150 hover:bg-[#2238C9] whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2D46E6]"
          >
            Launch Nextrade AI
          </motion.button>
        </div>

        {/* Mobile Menu Trigger */}
        <button
          type="button"
          onClick={() => setMobileOpen((prev) => !prev)}
          aria-expanded={mobileOpen}
          aria-label={mobileOpen ? 'Close navigation menu' : 'Open navigation menu'}
          className="inline-flex md:hidden h-11 w-11 items-center justify-center rounded-md border border-[#E4E8F2] text-[#080B12] hover:bg-[#F7F8FA] cursor-pointer"
        >
          {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      {/* Mobile Navigation Drawer */}
      <AnimatePresence initial={false}>
        {mobileOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className="md:hidden overflow-hidden border-t border-[#E4E8F2] bg-[#FFFFFF] max-h-[82vh] overflow-y-auto"
          >
            <div className="px-4 py-4 space-y-3">
              <nav aria-label="Mobile navigation" className="divide-y divide-[#E4E8F2]">
                {NAV_GROUPS.map((group) => {
                  const expanded = mobileExpandedGroup === group.id;
                  return (
                    <div key={group.id} className="py-1.5">
                      <button
                        type="button"
                        aria-expanded={expanded}
                        onClick={() =>
                          setMobileExpandedGroup(expanded ? null : group.id)
                        }
                        className="flex h-11 w-full items-center justify-between px-2 text-sm font-semibold text-[#080B12] cursor-pointer"
                      >
                        <span>{group.label}</span>
                        <ChevronDown
                          className={`h-4 w-4 text-[#667085] transition-transform ${
                            expanded ? 'rotate-180 text-[#2D46E6]' : ''
                          }`}
                          aria-hidden="true"
                        />
                      </button>

                      {expanded && (
                        <div className="pb-2 pl-2 space-y-1">
                          {group.items.map((item) =>
                            item.external ? (
                              <a
                                key={item.label}
                                href={item.href}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={() => setMobileOpen(false)}
                                className="flex h-10 items-center justify-between rounded-md px-3 text-sm text-[#667085] hover:bg-[#F7F8FA] hover:text-[#080B12]"
                              >
                                <span>{item.label}</span>
                                <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
                              </a>
                            ) : (
                              <a
                                key={item.label}
                                href={item.href}
                                onClick={(e) => {
                                  e.preventDefault();
                                  handleRouteNavigate(item.href);
                                }}
                                className={`flex h-10 items-center rounded-md px-3 text-sm ${
                                  currentPath === item.href
                                    ? 'bg-[#EFF2FA] font-semibold text-[#2D46E6]'
                                    : 'text-[#667085] hover:bg-[#F7F8FA] hover:text-[#080B12]'
                                }`}
                              >
                                {item.label}
                              </a>
                            ),
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </nav>

              <div className="pt-2 space-y-2 border-t border-[#E4E8F2]">
                {status === 'authenticated' && user ? (
                  <>
                    <div className="px-2 py-1 text-xs text-[#667085]">
                      Signed in as <strong className="text-[#080B12]">{user.fullName}</strong>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => handleRouteNavigate('/app/account')}
                        className="h-10 rounded-md border border-[#E4E8F2] bg-[#F7F8FA] text-xs font-semibold text-[#080B12] cursor-pointer"
                      >
                        Account Settings
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRouteNavigate('/app/security')}
                        className="h-10 rounded-md border border-[#E4E8F2] bg-[#F7F8FA] text-xs font-semibold text-[#080B12] cursor-pointer"
                      >
                        Security
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleLogout()}
                      className="w-full h-10 rounded-md border border-[#FECACA] bg-[#FEF2F2] text-xs font-semibold text-[#DC2626] cursor-pointer"
                    >
                      Sign Out
                    </button>
                  </>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => handleRouteNavigate('/login')}
                      className="h-11 rounded-md border border-[#E4E8F2] bg-[#FFFFFF] text-sm font-semibold text-[#080B12] hover:border-[#2D46E6] cursor-pointer"
                    >
                      Sign In
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRouteNavigate('/signup')}
                      className="h-11 rounded-md border border-[#E4E8F2] bg-[#F7F8FA] text-sm font-semibold text-[#080B12] hover:border-[#2D46E6] cursor-pointer"
                    >
                      Sign Up
                    </button>
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => handleRouteNavigate('/app')}
                  className="w-full h-11 rounded-md bg-[#2D46E6] text-sm font-semibold text-[#FFFFFF] hover:bg-[#2238C9] cursor-pointer"
                >
                  Launch Nextrade AI
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.header>
  );
};
