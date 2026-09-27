const axios = require('axios');

const BASE_URL = process.env.VTPASS_BASE_URL || 'https://sandbox.vtpass.com/api';

const vtpassHeaders = () => ({
  'api-key': process.env.VTPASS_API_KEY,
  'public-key': process.env.VTPASS_PUBLIC_KEY,
  'secret-key': process.env.VTPASS_SECRET_KEY,
  'Content-Type': 'application/json'
});

// ─── BUY AIRTIME ────────────────────────────────────────────
const buyAirtime = async ({ phone, amount, network, requestId }) => {
  const serviceMap = { MTN: 'mtn', Airtel: 'airtel', Glo: 'glo', '9mobile': 'etisalat' };
  const serviceId = serviceMap[network];

  const res = await axios.post(`${BASE_URL}/pay`, {
    request_id: requestId,
    serviceID: serviceId,
    amount,
    phone
  }, { headers: vtpassHeaders() });

  return res.data;
};

// ─── BUY DATA ───────────────────────────────────────────────
const buyData = async ({ phone, serviceId, variationCode, requestId }) => {
  const res = await axios.post(`${BASE_URL}/pay`, {
    request_id: requestId,
    serviceID: serviceId,
    billersCode: phone,
    variation_code: variationCode,
    amount: null,
    phone
  }, { headers: vtpassHeaders() });

  return res.data;
};

// ─── PAY CABLE TV ───────────────────────────────────────────
const payCable = async ({ smartCardNumber, serviceId, variationCode, phone, requestId }) => {
  const res = await axios.post(`${BASE_URL}/pay`, {
    request_id: requestId,
    serviceID: serviceId,
    billersCode: smartCardNumber,
    variation_code: variationCode,
    phone,
    subscription_type: 'change'
  }, { headers: vtpassHeaders() });

  return res.data;
};

// ─── PAY ELECTRICITY ────────────────────────────────────────
const payElectricity = async ({ meterNumber, serviceId, variationCode, amount, phone, requestId }) => {
  const res = await axios.post(`${BASE_URL}/pay`, {
    request_id: requestId,
    serviceID: serviceId,
    billersCode: meterNumber,
    variation_code: variationCode,
    amount,
    phone
  }, { headers: vtpassHeaders() });

  return res.data;
};

// ─── BUY EXAM PIN ───────────────────────────────────────────
const buyExamPin = async ({ serviceId, variationCode, phone, quantity, requestId }) => {
  const res = await axios.post(`${BASE_URL}/pay`, {
    request_id: requestId,
    serviceID: serviceId,
    variation_code: variationCode,
    phone,
    quantity
  }, { headers: vtpassHeaders() });

  return res.data;
};

// ─── VERIFY SMART CARD ──────────────────────────────────────
const verifySmartCard = async (billersCode, serviceId) => {
  const res = await axios.post(`${BASE_URL}/merchant-verify`, {
    billersCode,
    serviceID: serviceId
  }, { headers: vtpassHeaders() });

  return res.data;
};

// ─── VERIFY METER ───────────────────────────────────────────
const verifyMeter = async (meterNumber, serviceId, variationType) => {
  const res = await axios.post(`${BASE_URL}/merchant-verify`, {
    billersCode: meterNumber,
    serviceID: serviceId,
    type: variationType
  }, { headers: vtpassHeaders() });

  return res.data;
};

// ─── GET VARIATIONS ─────────────────────────────────────────
const getVariations = async (serviceId) => {
  const res = await axios.get(`${BASE_URL}/service-variations?serviceID=${serviceId}`, {
    headers: vtpassHeaders()
  });
  return res.data;
};

// ─── CHECK TRANSACTION STATUS ───────────────────────────────
const checkTransactionStatus = async (requestId) => {
  const res = await axios.post(`${BASE_URL}/requery`, {
    request_id: requestId
  }, { headers: vtpassHeaders() });

  return res.data;
};

// ─── PARSE VTPASS RESPONSE ──────────────────────────────────
const parseVTpassResponse = (response) => {
  if (!response || !response.code) return { success: false, message: 'No response from provider' };

  const successCodes = ['000', '099'];
  const success = successCodes.includes(response.code);

  return {
    success,
    code: response.code,
    message: response.response_description || (success ? 'Transaction successful' : 'Transaction failed'),
    data: response.content?.transactions || response.content || null,
    token: response.purchased_code || null
  };
};

module.exports = {
  buyAirtime, buyData, payCable, payElectricity,
  buyExamPin, verifySmartCard, verifyMeter,
  getVariations, checkTransactionStatus, parseVTpassResponse
};
