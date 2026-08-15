import ProductionCard from './ProductionCard';

export default function ProductionsList({ productions, onRefresh }) {
  if (!productions || productions.length === 0) {
    return null;
  }

  return (
    <div className="space-y-3">
      {productions.map((production) => (
        <ProductionCard
          key={production.id}
          production={production}
          onRefresh={onRefresh}
        />
      ))}
    </div>
  );
}
