import VisitorSeed from "./visitor-seed";

export default function InvestLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <VisitorSeed />
      {children}
    </>
  );
}
