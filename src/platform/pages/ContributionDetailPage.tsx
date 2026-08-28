/** @jsxImportSource react */

interface ContributionDetailPageProps {
  contributionNumber?: string;
}

export default function ContributionDetailPage({
  contributionNumber,
}: ContributionDetailPageProps) {
  return (
    <section className="page-content">
      <h1>{contributionNumber ? `Contribution #${contributionNumber}` : 'Contribution history'}</h1>
    </section>
  );
}
