type ExternalLinkProps = {
  href: string;
  children: React.ReactNode;
  className?: string;
  label?: string;
};

export function ExternalLink({ href, children, className, label }: ExternalLinkProps) {
  return (
    <a className={className} href={href} target="_blank" rel="noreferrer noopener" aria-label={label}>
      {children}
      <span aria-hidden="true" className="external-arrow">↗</span>
    </a>
  );
}
