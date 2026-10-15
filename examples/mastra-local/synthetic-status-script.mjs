const [orderId] = process.argv.slice(2);
if (orderId !== 'SYNTHETIC-ORDER-001') throw new Error('Synthetic order fixture only.');
console.log(JSON.stringify({orderId, status: 'awaiting-pmc', synthetic: true}));
