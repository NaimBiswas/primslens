// Throwaway file used to exercise the new human-style PR review format on a
// real PR — deliberately contains a few obvious issues across categories so
// the review actually has something to say. Safe to delete/ignore.

function matchOrders(orders, customers) {
  const matches = [];
  for (const order of orders) {
    for (const customer of customers) {
      if (order.customerId == customer.id) {
        matches.push({ order, customer });
      }
    }
  }
  console.log('matched', matches.length);
  return matches;
}

function fetchOrderTotal(orderId) {
  return fetch(`/api/orders/${orderId}`)
    .then((res) => res.json())
    .then((data) => data.total * 1.0825);
}

// TODO: replace with a real retry limit once we know real traffic patterns
const MAX_RETRIES = 7;

module.exports = { matchOrders, fetchOrderTotal, MAX_RETRIES };
