/**
 * Data processing services
 */

function analyzeData(dataset) {
  if (!Array.isArray(dataset) || dataset.length === 0) {
    return { error: 'Invalid dataset provided' };
  }

  const analysis = {
    totalRecords: dataset.length,
    summary: {},
    statistics: {}
  };

  // Basic statistics
  if (dataset.every(item => typeof item === 'number')) {
    const numbers = dataset.sort((a, b) => a - b);
    analysis.statistics = {
      min: Math.min(...numbers),
      max: Math.max(...numbers),
      average: numbers.reduce((sum, n) => sum + n, 0) / numbers.length,
      median: numbers[Math.floor(numbers.length / 2)]
    };
  }

  // Type analysis
  const types = {};
  dataset.forEach(item => {
    const type = typeof item;
    types[type] = (types[type] || 0) + 1;
  });
  analysis.summary.typeDistribution = types;

  return analysis;
}

function transformData(data, transformType) {
  switch (transformType) {
    case 'uppercase':
      return data.map(item => 
        typeof item === 'string' ? item.toUpperCase() : item
      );
    case 'lowercase':
      return data.map(item => 
        typeof item === 'string' ? item.toLowerCase() : item
      );
    case 'capitalize':
      return data.map(item => 
        typeof item === 'string' ? capitalizeWords(item) : item
      );
    default:
      return data;
  }
}