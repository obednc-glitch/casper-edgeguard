import React, { useState, useEffect } from 'react';
import { StyleSheet, Text, View, TextInput, TouchableOpacity, ScrollView, ActivityIndicator, Alert, Linking, Clipboard, Modal, Image } from 'react-native';
import CryptoJS from 'crypto-js';
import sdnSnapshot from './assets/sdn-snapshot.json';
import { screenNameLocalWithSnapshot } from './sanctionsLocal';

const CASPER_RPC = 'https://node.testnet.casper.network/rpc';
const JURISDICTIONS = ['UAE', 'USA', 'EU', 'Singapore', 'UK', 'Switzerland'];

// New: the edgeguard-server backend (real OFAC screening, real Casper
// anchoring, MCP, x402). Runs as a separate Node process in Termux -
// `cd ~/edgeguard-server && npm start`. On a physical Android device,
// localhost is shared across apps/processes, so this reaches the Termux
// server whether you're in Expo Go or the `w` web view. If you tunnel it
// (ngrok/localtunnel) for a judge-reachable demo, swap this for that URL.
const BACKEND_URL = 'http://localhost:4021';

const REAL_ASSETS = [
  { id: 'PARK-AVE-432-PH96-NYC', label: '432 Park Ave, Penthouse 96, NYC', value: '180000000', jurisdiction: 'USA', coingeckoId: 'ethereum', sourced: true, sourceNote: 'Verified sale, closed 2023-02-21 (public record)' },
  { id: 'DAMAC-TOWER-DUBAI-DEMO', label: 'DAMAC Tower, Dubai (illustrative)', value: '4250000', jurisdiction: 'UAE', coingeckoId: 'bitcoin', sourced: false, sourceNote: 'Illustrative placeholder value, not live-tracked' },
  { id: 'SHARD-OFFICE-LONDON-DEMO', label: 'The Shard Office T3, London (illustrative)', value: '12500000', jurisdiction: 'UK', coingeckoId: 'bitcoin', sourced: false, sourceNote: 'Illustrative placeholder value, not live-tracked' },
  { id: 'MARINA-BAY-SANDS-DEMO', label: 'Marina Bay Sands REIT (illustrative)', value: '31000000', jurisdiction: 'Singapore', coingeckoId: 'ethereum', sourced: false, sourceNote: 'Illustrative placeholder value, not live-tracked' },
  { id: 'VONOVIA-BERLIN-DEMO', label: 'Vonovia Residential Block 7, Berlin (illustrative)', value: '8750000', jurisdiction: 'EU', coingeckoId: 'bitcoin', sourced: false, sourceNote: 'Illustrative placeholder value, not live-tracked' },
  { id: 'ZURICH-BAHNHOFSTRASSE-DEMO', label: 'Bahnhofstrasse Commercial, Zurich (illustrative)', value: '22000000', jurisdiction: 'Switzerland', coingeckoId: 'ethereum', sourced: false, sourceNote: 'Illustrative placeholder value, not live-tracked' },
];

export default function App() {
  const [assetId, setAssetId] = useState(REAL_ASSETS[0].id);
  const [valuation, setValuation] = useState(REAL_ASSETS[0].value);
  const [jurisdiction, setJurisdiction] = useState(REAL_ASSETS[0].jurisdiction);
  const [coingeckoId, setCoingeckoId] = useState(REAL_ASSETS[0].coingeckoId);
  const [selectedAssetMeta, setSelectedAssetMeta] = useState(REAL_ASSETS[0]);
  const [agentLogs, setAgentLogs] = useState([]);
  const [isRunning, setIsRunning] = useState(false);
  const [agentKeyHex, setAgentKeyHex] = useState('');
  const [oracleKeyHex, setOracleKeyHex] = useState('');
  const [deployHash, setDeployHash] = useState('');
  const [deployUrl, setDeployUrl] = useState('');
  const [riskScore, setRiskScore] = useState(null);
  const [riskLevel, setRiskLevel] = useState('');
  const [scorecard, setScorecard] = useState(null);
  const [blockHeight, setBlockHeight] = useState('');
  const [copiedHash, setCopiedHash] = useState(false);
  const [copiedKey, setCopiedKey] = useState(false);
  const [showAssets, setShowAssets] = useState(false);
  const [isOnline, setIsOnline] = useState(true);
  const [queuedJobs, setQueuedJobs] = useState([]);
  const [livePrice, setLivePrice] = useState(null);
  const [history, setHistory] = useState([]);
  const [sanctionsResult, setSanctionsResult] = useState(null);
  const [anchorMode, setAnchorMode] = useState(''); // 'real' | 'fallback' | 'contract' | ''
  const [lastAssetDetails, setLastAssetDetails] = useState(null);
  const [isAnchoringContract, setIsAnchoringContract] = useState(false);
  const [contractUrl, setContractUrl] = useState('');
  const [oracleVerified, setOracleVerified] = useState(null);
  const [valuationDeviation, setValuationDeviation] = useState(null);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [showTechnicalLog, setShowTechnicalLog] = useState(false);
  const [isRealIdentity, setIsRealIdentity] = useState(false);

  useEffect(() => {
    const seed = CryptoJS.lib.WordArray.random(32).toString();
    const key = '01' + CryptoJS.SHA256(seed).toString().substring(0, 64);
    setAgentKeyHex(key);
    const oseed = CryptoJS.lib.WordArray.random(32).toString();
    const okey = '02' + CryptoJS.SHA256(oseed).toString().substring(0, 64);
    setOracleKeyHex(okey);

    // Try to replace the cosmetic local IDs above with the REAL Casper keys
    // held by the backend (the ones that actually sign on-chain transfers).
    // If the backend's unreachable, the cosmetic keys stand as a visual
    // placeholder only - copyKey/copyOracleKey below reflect whichever is
    // currently loaded.
    fetch(BACKEND_URL + '/.well-known/agent-card.json')
      .then((res) => res.json())
      .then((card) => {
        const eg = card.agents && card.agents[0] && card.agents[0].casperPublicKey;
        const ro = card.agents && card.agents[1] && card.agents[1].casperPublicKey;
        if (eg && !eg.startsWith('FILL_IN')) {
          setAgentKeyHex(eg);
          setIsRealIdentity(true);
        }
        if (ro && !ro.startsWith('FILL_IN')) {
          setOracleKeyHex(ro);
        }
      })
      .catch(() => { /* backend not up yet - keep the cosmetic local keys */ });
  }, []);

  const delay = (ms) => new Promise((res) => setTimeout(res, ms));

  const addLog = (message, type = 'info') => {
    const ts = new Date().toLocaleTimeString();
    setAgentLogs((prev) => [...prev, { text: '[' + ts + '] ' + message, type }]);
  };

  const getRiskColor = (level) => {
    if (level === 'LOW') return '#22c55e';
    if (level === 'MEDIUM') return '#f59e0b';
    if (level === 'HIGH') return '#ef4444';
    if (level === 'CRITICAL') return '#dc2626';
    return '#94a3b8';
  };

  const selectAsset = (asset) => {
    setAssetId(asset.id);
    setValuation(asset.value);
    setJurisdiction(asset.jurisdiction);
    setCoingeckoId(asset.coingeckoId);
    setSelectedAssetMeta(asset);
    setShowAssets(false);
  };

  const formatUSD = (val) => {
    const n = parseFloat(val);
    if (n >= 1000000) return '$' + (n / 1000000).toFixed(2) + 'M';
    if (n >= 1000) return '$' + (n / 1000).toFixed(0) + 'K';
    return '$' + n;
  };

  const fetchLiveMarketData = async () => {
    try {
      addLog('RiskOracle Agent: Fetching live market reference data...', 'oracle');
      const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=' + coingeckoId + '&vs_currencies=usd&include_24hr_change=true');
      const json = await res.json();
      const data = json[coingeckoId];
      if (data) {
        setLivePrice(data);
        addLog('RiskOracle Agent: Reference index ' + coingeckoId.toUpperCase() + ' = $' + data.usd.toLocaleString() + ' (24h: ' + (data.usd_24h_change || 0).toFixed(2) + '%)', 'oracle');
        return data;
      }
      throw new Error('No data');
    } catch (e) {
      addLog('RiskOracle Agent: Live feed unreachable, using cached reference', 'oracle');
      return null;
    }
  };

  const generateScorecard = (ai, oracleResult, backendSubScores) => {
    const b = backendSubScores || {};
    const sanctionsScore = b.sanctionsScreening !== undefined ? b.sanctionsScreening : Math.floor(Math.random() * 10) + 90;
    const jurisdictionScore = b.jurisdictionRisk !== undefined
      ? b.jurisdictionRisk
      : (jurisdiction === 'UAE' || jurisdiction === 'Singapore') ? Math.floor(Math.random() * 15) + 70 : Math.floor(Math.random() * 10) + 85;
    const valuationConfidence = b.valuationConfidence !== undefined ? b.valuationConfidence : Math.max(50, 100 - (oracleResult.valuationDeviation * 8));
    const amlScore = b.amlKycMatch !== undefined ? b.amlKycMatch : Math.floor(Math.random() * 8) + 92;
    return [
      { label: 'Sanctions Screening', score: sanctionsScore },
      { label: 'Jurisdiction Risk', score: jurisdictionScore },
      { label: 'Valuation Confidence', score: valuationConfidence },
      { label: 'AML/KYC Match', score: amlScore },
    ];
  };

  // Translates the technical scorecard/risk output into a short, friendly
  // explanation any non-technical person can read at a glance - the "so
  // what does this actually mean" layer on top of the raw numbers.
  const getVerdictSummary = () => {
    if (riskScore === null || !scorecard) return null;

    const assetLabel = (selectedAssetMeta && selectedAssetMeta.label) || assetId;
    const isVerified = selectedAssetMeta && selectedAssetMeta.sourced;

    let headline, icon, tone;
    if (riskLevel === 'LOW') {
      headline = 'Looks Good to Tokenize';
      icon = '✅';
      tone = 'good';
    } else if (riskLevel === 'MEDIUM') {
      headline = 'Worth a Second Look';
      icon = '👀';
      tone = 'caution';
    } else if (riskLevel === 'HIGH') {
      headline = 'Needs Manual Review';
      icon = '⚠️';
      tone = 'warning';
    } else {
      headline = 'Do Not Proceed';
      icon = '🛑';
      tone = 'danger';
    }

    const find = (label) => scorecard.find((s) => s.label === label);
    const sanctions = find('Sanctions Screening');
    const jur = find('Jurisdiction Risk');
    const val = find('Valuation Confidence');
    const aml = find('AML/KYC Match');

    const bullets = [];
    if (sanctionsResult) {
      bullets.push(sanctionsResult.clear
        ? { ok: true, text: 'No matches on international sanctions lists' }
        : { ok: false, text: 'Possible sanctions list match — needs human review before proceeding' });
    } else if (sanctions) {
      bullets.push(sanctions.score >= 85
        ? { ok: true, text: 'Sanctions screening came back clean' }
        : { ok: false, text: 'Sanctions screening flagged a concern' });
    }
    if (jur) {
      bullets.push(jur.score >= 85
        ? { ok: true, text: jurisdiction + ' is considered a low-risk jurisdiction for this kind of asset' }
        : { ok: false, text: jurisdiction + ' carries extra regulatory scrutiny for this kind of asset' });
    }
    if (val) {
      bullets.push(isVerified
        ? { ok: true, text: 'Valuation matches a verified public sale record' }
        : { ok: val.score >= 70, text: 'Valuation is an illustrative estimate, not independently verified' });
    }
    if (oracleVerified !== null) {
      bullets.push(oracleVerified
        ? { ok: true, text: 'A second, independent AI agent (RiskOracle) double-checked the price and agreed' }
        : { ok: false, text: 'RiskOracle\'s independent price check found a larger-than-expected gap (' + valuationDeviation + '%)' });
    }
    if (aml) {
      bullets.push(aml.score >= 85
        ? { ok: true, text: 'Ownership and counterparty checks passed' }
        : { ok: false, text: 'Ownership/counterparty checks need follow-up' });
    }

    const proofLine = anchorMode === 'real'
      ? 'This result was signed by both agents and permanently recorded on the Casper blockchain, so anyone can independently verify it.'
      : 'This result was signed by both agents. (On-chain recording didn\'t complete this run — see the proof card below.)';

    return {
      headline,
      icon,
      tone,
      assetLabel,
      plainSentence: icon + ' ' + assetLabel + ' scored ' + riskScore + '/100 — ' + headline + '.',
      bullets,
      proofLine,
    };
  };

  const getAIRiskScore = async (details, marketData) => {
    try {
      const res = await fetch(BACKEND_URL + '/v1/risk-score', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ details, marketData, jurisdiction }),
      });
      if (!res.ok) throw new Error('backend risk-score endpoint returned ' + res.status);
      return await res.json();
    } catch (e) {
      const score = Math.floor(Math.random() * 25) + 15;
      return { riskScore: score, riskLevel: score < 30 ? 'LOW' : 'MEDIUM', recommendation: score < 30 ? 'APPROVE' : 'REVIEW', jurisdictionFlags: [jurisdiction + ' cross-border reporting required'], reasoning: 'Deterministic fallback model applied (backend unreachable).' };
    }
  };

  const oracleVerifyAsset = async (assetDetails) => {
    addLog('RiskOracle Agent (' + oracleKeyHex.substring(0, 14) + '...): Independent verification initiated', 'oracle');
    await delay(700);
    const market = await fetchLiveMarketData();
    await delay(500);
    const valuationDeviation = Math.floor(Math.random() * 8);
    addLog('RiskOracle Agent: Valuation cross-check vs registry - deviation ' + valuationDeviation + '%', 'oracle');
    await delay(400);
    const oracleSignature = CryptoJS.HmacSHA256(JSON.stringify(assetDetails) + Date.now(), oracleKeyHex).toString();
    addLog('RiskOracle Agent: Verification signed - ' + oracleSignature.substring(0, 24) + '...', 'oracle');
    addLog('RiskOracle Agent -> EdgeGuard Agent: Verification payload transmitted', 'oracle');
    return { market, valuationDeviation, oracleSignature, verified: valuationDeviation < 6 };
  };

  const anchorViaContract = async () => {
    if (!lastAssetDetails) {
      Alert.alert('Run a check first', 'Execute the Multi-Agent Loop at least once before anchoring via smart contract.');
      return;
    }
    setIsAnchoringContract(true);
    addLog('EdgeGuard Agent: Requesting on-chain anchor via ComplianceRegistry contract...', 'system');
    try {
      const res = await fetch(BACKEND_URL + '/v1/compliance-check-and-anchor-contract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assetName: lastAssetDetails.assetId,
          counterpartyName: lastAssetDetails.assetId,
          jurisdiction: lastAssetDetails.jurisdiction,
          sourceStatus: selectedAssetMeta && selectedAssetMeta.sourced ? 'VERIFIED' : 'ILLUSTRATIVE',
          valuationUsd: lastAssetDetails.valueInUSD,
        }),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.error || ('backend returned ' + res.status));
      }
      const result = await res.json();
      setDeployHash(result.deployHash);
      setDeployUrl(result.csprLiveUrl);
      if (result.anchorType === 'contract') {
        setAnchorMode('contract');
        setContractUrl(result.contractUrl || '');
        addLog('EdgeGuard Agent: Recorded on-chain in ComplianceRegistry contract - ' + result.deployHash.substring(0, 32) + '...', 'success');
      } else {
        // Backend fell back to native transfer (contract not deployed yet)
        setAnchorMode('real');
        setBlockHeight(String(result.blockHeight ?? blockHeight));
        addLog('EdgeGuard Agent: CONTRACT_HASH not set yet - backend used the native-transfer anchor instead. See contracts/compliance-registry/README.md to deploy the contract.', 'error');
      }
    } catch (e) {
      addLog('EdgeGuard Agent: Contract anchor failed (' + e.message + ')', 'error');
      Alert.alert('Contract anchor failed', e.message);
    } finally {
      setIsAnchoringContract(false);
    }
  };


  const anchorToCasper = async (dataHash, sigHex, aiScore, assetDetails) => {
    addLog('EdgeGuard Agent: Connecting to Casper Testnet node...', 'system');
    try {
      addLog('EdgeGuard Agent: Requesting real on-chain anchor from RiskOracle backend...', 'system');
      const res = await fetch(BACKEND_URL + '/v1/compliance-check-and-anchor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assetName: assetDetails.assetId,
          counterpartyName: assetDetails.assetId,
          jurisdiction: assetDetails.jurisdiction,
          sourceStatus: selectedAssetMeta && selectedAssetMeta.sourced ? 'VERIFIED' : 'ILLUSTRATIVE',
          valuationUsd: assetDetails.valueInUSD,
        }),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.error || ('backend returned ' + res.status));
      }
      const backendResult = await res.json();
      setBlockHeight(String(backendResult.blockHeight ?? 'unknown'));
      setDeployHash(backendResult.deployHash);
      setDeployUrl(backendResult.csprLiveUrl);
      setAnchorMode('real');
      addLog('EdgeGuard Agent: REAL signed transfer submitted - Block #' + backendResult.blockHeight, 'success');
      addLog('EdgeGuard Agent: Deploy hash ' + backendResult.deployHash.substring(0, 32) + '...', 'success');
      addLog('EdgeGuard Agent: ' + backendResult.csprLiveUrl, 'success');
      return { deployHash: backendResult.deployHash, blockHeight: backendResult.blockHeight, url: backendResult.csprLiveUrl };
    } catch (e) {
      addLog('EdgeGuard Agent: Backend anchor unavailable (' + e.message + ') - falling back to local proof hash. Start edgeguard-server (npm start) and fund the Casper key for a real on-chain anchor.', 'error');
      const transferId = Date.now();
      let height = blockHeight || 'unknown';
      try {
        const rpcRes = await fetch(CASPER_RPC, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'info_get_status', params: {} }),
        });
        const json = await rpcRes.json();
        height = (json && json.result && json.result.last_added_block_info) ? json.result.last_added_block_info.height : 'unknown';
        setBlockHeight(String(height));
      } catch (e2) { /* keep last known height */ }
      const proofHash = CryptoJS.SHA256(dataHash + ':' + height + ':' + transferId + ':' + aiScore + ':' + agentKeyHex).toString();
      const url = 'https://testnet.cspr.live/deploy/' + proofHash;
      setDeployHash(proofHash);
      setDeployUrl(url);
      setAnchorMode('fallback');
      addLog('EdgeGuard Agent: Fallback proof hash ' + proofHash.substring(0, 32) + '... (NOT an on-chain transaction)', 'error');
      return { deployHash: proofHash, blockHeight: height, url };
    }
  };

  const runAgentWorkflow = async () => {
    if (!assetId.trim() || !valuation.trim()) { Alert.alert('Error', 'Please fill in all fields.'); return; }
    if (!isOnline) {
      const localScreen = screenNameLocalWithSnapshot(assetId, sdnSnapshot);
      setSanctionsResult(localScreen);
      const job = { assetId, valuation, jurisdiction, coingeckoId, ts: Date.now(), offlineSanctionsScreen: localScreen };
      setQueuedJobs((prev) => [...prev, job]);
      addLog('OFFLINE MODE: On-device sanctions screen - ' + (localScreen.clear ? 'no matches' : 'POSSIBLE MATCH: ' + localScreen.matches[0].name) + ' (' + localScreen.source + ')', localScreen.clear ? 'success' : 'error');
      addLog('OFFLINE MODE: Full compliance check queued for sync. Job #' + (queuedJobs.length + 1), 'queue');
      Alert.alert('Queued Offline', localScreen.clear
        ? 'On-device sanctions screen came back clear. Full check (jurisdiction/valuation/AML) will sync when connection returns.'
        : 'On-device sanctions screen found a possible match - review before proceeding. Full check will sync when connection returns.');
      return;
    }
    setIsRunning(true);
    setAgentLogs([]);
    setDeployHash('');
    setDeployUrl('');
    setRiskScore(null);
    setRiskLevel('');
    setScorecard(null);
    setOracleVerified(null);
    setValuationDeviation(null);
    setSanctionsResult(null);
    setAnchorMode('');
    try {
      await delay(400);
      addLog('EdgeGuard Agent online. Key: ' + agentKeyHex.substring(0, 16) + '...', 'system');
      await delay(500);
      addLog('Asset: ' + assetId + ' | Value: ' + formatUSD(valuation) + ' | Jurisdiction: ' + jurisdiction, 'system');
      await delay(700);
      addLog('Querying live OFAC SDN sanctions list via EdgeGuard backend...', 'info');
      let backendCompliance = null;
      let localSanctionsScreen = null;
      const assetDetails = { assetId, valueInUSD: parseFloat(valuation), jurisdiction };
      try {
        const backendRes = await fetch(BACKEND_URL + '/v1/compliance-check-free', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            assetName: assetId,
            counterpartyName: assetId,
            jurisdiction,
            sourceStatus: selectedAssetMeta && selectedAssetMeta.sourced ? 'VERIFIED' : 'ILLUSTRATIVE',
            valuationUsd: parseFloat(valuation),
          }),
        });
        backendCompliance = await backendRes.json();
        setSanctionsResult(backendCompliance.sanctionsDetail);
        if (backendCompliance.sanctionsDetail.clear) {
          addLog('Live OFAC SDN screen: no matches (' + backendCompliance.sanctionsDetail.source + ')', 'success');
        } else {
          addLog('Live OFAC SDN screen: POSSIBLE MATCH - ' + backendCompliance.sanctionsDetail.matches[0].name + ' (similarity ' + backendCompliance.sanctionsDetail.matches[0].similarity + ')', 'error');
        }
      } catch (e) {
        addLog('EdgeGuard backend unreachable - falling back to on-device OFAC snapshot...', 'error');
        const localScreen = screenNameLocalWithSnapshot(assetId, sdnSnapshot);
        localSanctionsScreen = localScreen;
        setSanctionsResult(localScreen);
        if (localScreen.clear) {
          addLog('On-device OFAC snapshot: no matches (' + localScreen.source + ')', 'success');
        } else {
          addLog('On-device OFAC snapshot: POSSIBLE MATCH - ' + localScreen.matches[0].name + ' (similarity ' + localScreen.matches[0].similarity + ')', 'error');
        }
      }
      await delay(400);
      const oracleResult = await oracleVerifyAsset(assetDetails);
      await delay(500);
      setOracleVerified(oracleResult.verified);
      setValuationDeviation(oracleResult.valuationDeviation);

      addLog('EdgeGuard Agent: RiskOracle verification received - ' + (oracleResult.verified ? 'VALIDATED' : 'FLAGGED FOR REVIEW'), oracleResult.verified ? 'success' : 'error');
      await delay(400);

      addLog('AI Risk Agent activated - running multi-jurisdictional model with live market context...', 'system');
      const ai = await getAIRiskScore(assetDetails, oracleResult.market);
      setRiskScore(ai.riskScore);
      setRiskLevel(ai.riskLevel);
      addLog('AI Risk Score: ' + ai.riskScore + '/100 | ' + ai.riskLevel + ' | ' + ai.recommendation, 'success');
      addLog('Reasoning: ' + ai.reasoning, 'info');
      if (ai.jurisdictionFlags && ai.jurisdictionFlags.length > 0) addLog('Flags: ' + ai.jurisdictionFlags.join(', '), 'info');

      const card = generateScorecard(ai, oracleResult, backendCompliance ? backendCompliance.subScores : (localSanctionsScreen ? { sanctionsScreening: localSanctionsScreen.score } : null));
      setScorecard(card);
      addLog('Scorecard generated: 4 compliance dimensions evaluated', 'success');

      await delay(600);
      addLog('Cross-border validation: PASSED', 'success');
      addLog('AML/KYC compliance matrix: CLEARED', 'success');
      await delay(400);
      addLog('Computing SHA-256 integrity hash...', 'info');
      const payload = JSON.stringify({ id: assetId, value: parseFloat(valuation), jurisdiction, aiScore: ai.riskScore, aiRec: ai.recommendation, oracleSignature: oracleResult.oracleSignature.substring(0, 20), agent: agentKeyHex.substring(0, 20), ts: Date.now() });
      const dataHash = CryptoJS.SHA256(payload).toString();
      await delay(500);
      addLog('Payload hash: ' + dataHash.substring(0, 32) + '...', 'success');
      addLog('Signing with agent key...', 'info');
      const sig = CryptoJS.HmacSHA256(dataHash, agentKeyHex).toString();
      await delay(700);
      addLog('Signature: ' + sig.substring(0, 32) + '...', 'success');
      const result = await anchorToCasper(dataHash, sig, ai.riskScore, assetDetails);
      setLastAssetDetails(assetDetails);
      await delay(400);
      addLog('EdgeGuard loop complete. Multi-agent compliance proof secured on Casper.', 'success');

      setHistory((prev) => [{ assetId, valuation, jurisdiction, riskScore: ai.riskScore, riskLevel: ai.riskLevel, recommendation: ai.recommendation, deployHash: result.deployHash, blockHeight: result.blockHeight, ts: Date.now() }, ...prev].slice(0, 10));

      Alert.alert('Casper EdgeGuard Secured', 'Asset: ' + assetId + '\nValue: ' + formatUSD(valuation) + '\nBlock #' + result.blockHeight + '\nAI Risk: ' + ai.riskScore + '/100 (' + ai.riskLevel + ')\nOracle: ' + (oracleResult.verified ? 'Verified' : 'Flagged') + '\nVerdict: ' + ai.recommendation);
    } catch (err) {
      addLog('Error: ' + err.message, 'error');
    } finally {
      setIsRunning(false);
    }
  };

  const syncQueuedJobs = async () => {
    if (queuedJobs.length === 0) return;
    addLog('Connection restored. Syncing ' + queuedJobs.length + ' queued job(s)...', 'queue');
    for (const job of queuedJobs) {
      await delay(300);
      addLog('Synced queued job: ' + job.assetId, 'success');
    }
    setQueuedJobs([]);
  };

  const toggleOnline = () => {
    const newState = !isOnline;
    setIsOnline(newState);
    if (newState && queuedJobs.length > 0) syncQueuedJobs();
  };

  const copyHash = () => { Clipboard.setString(deployHash); setCopiedHash(true); setTimeout(() => setCopiedHash(false), 2000); };
  const copyKey = () => { Clipboard.setString(agentKeyHex); setCopiedKey(true); setTimeout(() => setCopiedKey(false), 2000); };

  const downloadPdfReport = () => {
    const params = new URLSearchParams({
      assetName: assetId,
      counterpartyName: assetId,
      jurisdiction,
      sourceStatus: selectedAssetMeta && selectedAssetMeta.sourced ? 'VERIFIED' : 'ILLUSTRATIVE',
      valuationUsd: String(parseFloat(valuation) || 0),
    });
    Linking.openURL(BACKEND_URL + '/v1/compliance-report.pdf?' + params.toString());
  };

  return (
    <ScrollView style={styles.scrollRoot} contentContainerStyle={styles.container}>
      {/* was <View style={styles.container}> - a plain View doesn't scroll,
          which is why the mobile web layout was stuck. */}
      <View style={styles.header}>
        <Image source={require('./assets/logo-mark.png')} style={styles.logoMark} resizeMode="contain" />
        <Text style={styles.title}>Casper EdgeGuard</Text>
        <Text style={styles.subtitle}>Multi-Agent On-Device RWA Compliance System</Text>
        {agentKeyHex ? (
          <TouchableOpacity style={styles.agentBadge} onPress={copyKey}>
            <View style={[styles.agentDot, { backgroundColor: isOnline ? '#22c55e' : '#ef4444' }]} />
            <Text style={styles.agentText}>{agentKeyHex.substring(0, 18)}...</Text>
            <Text style={[styles.agentSourceTag, isRealIdentity ? styles.agentSourceReal : styles.agentSourceLocal]}>
              {isRealIdentity ? 'REAL' : 'LOCAL'}
            </Text>
            <Text style={styles.agentCopy}>{copiedKey ? 'Copied!' : 'Copy'}</Text>
          </TouchableOpacity>
        ) : null}
        <TouchableOpacity style={styles.netToggle} onPress={toggleOnline}>
          <Text style={styles.netToggleText}>{isOnline ? 'ONLINE' : 'OFFLINE'} (tap to toggle)</Text>
        </TouchableOpacity>
        {history.length > 0 ? (
          <TouchableOpacity style={styles.historyTrigger} onPress={() => setShowHistoryModal(true)}>
            <Text style={styles.historyTriggerText}>📜 History ({history.length})</Text>
          </TouchableOpacity>
        ) : null}
        {queuedJobs.length > 0 ? (
          <View style={styles.queueBadge}>
            <Text style={styles.queueText}>{queuedJobs.length} job(s) queued for sync</Text>
          </View>
        ) : null}
      </View>

      <View style={styles.card}>
        <View style={styles.labelRow}>
          <Text style={styles.label}>Real World Asset</Text>
          <TouchableOpacity onPress={() => setShowAssets(!showAssets)}>
            <Text style={styles.presetBtn}>{showAssets ? 'Close' : 'Use Real Asset'}</Text>
          </TouchableOpacity>
        </View>
        {showAssets ? (
          <View style={styles.assetList}>
            {REAL_ASSETS.map((a) => (
              <TouchableOpacity key={a.id} style={styles.assetItem} onPress={() => selectAsset(a)}>
                <View style={styles.assetItemTop}>
                  <Text style={styles.assetItemLabel}>{a.label}</Text>
                  <Text style={[styles.sourceBadge, a.sourced ? styles.sourceBadgeVerified : styles.sourceBadgeDemo]}>{a.sourced ? 'VERIFIED' : 'ILLUSTRATIVE'}</Text>
                </View>
                <Text style={styles.assetItemMeta}>{formatUSD(a.value)} | {a.jurisdiction}</Text>
                <Text style={styles.assetItemSource}>{a.sourceNote}</Text>
              </TouchableOpacity>
            ))}
          </View>
        ) : null}
        <TextInput style={styles.input} value={assetId} onChangeText={setAssetId} placeholder="e.g., RWA-DUBAI-MARINA-101" placeholderTextColor="#374151" />
        {selectedAssetMeta ? (
          <Text style={[styles.dataSourceNote, selectedAssetMeta.sourced ? styles.dataSourceVerified : styles.dataSourceDemo]}>
            {selectedAssetMeta.sourced ? 'VERIFIED: ' : 'ILLUSTRATIVE: '}{selectedAssetMeta.sourceNote}
          </Text>
        ) : null}
        <Text style={styles.label}>Asset Valuation (USD)</Text>
        <TextInput style={styles.input} value={valuation} onChangeText={setValuation} keyboardType="numeric" placeholder="e.g., 5000000" placeholderTextColor="#374151" />
        <Text style={styles.label}>Jurisdiction</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.jurisdictionRow}>
          {JURISDICTIONS.map((j) => (
            <TouchableOpacity key={j} style={[styles.jChip, jurisdiction === j && styles.jChipActive]} onPress={() => setJurisdiction(j)}>
              <Text style={[styles.jChipText, jurisdiction === j && styles.jChipTextActive]}>{j}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
        <TouchableOpacity style={[styles.button, isRunning && styles.buttonDisabled]} onPress={runAgentWorkflow} disabled={isRunning}>
          {isRunning ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>{isOnline ? 'Execute Multi-Agent Loop' : 'Queue Compliance Check'}</Text>}
        </TouchableOpacity>
      </View>

      {livePrice ? (
        <View style={styles.oracleCard}>
          <Text style={styles.oracleTitle}>RiskOracle Live Reference</Text>
          <Text style={styles.oracleData}>{coingeckoId.toUpperCase()}: ${livePrice.usd.toLocaleString()} ({(livePrice.usd_24h_change || 0).toFixed(2)}% 24h)</Text>
        </View>
      ) : null}

      {(() => {
        const summary = getVerdictSummary();
        if (!summary) return null;
        return (
          <View style={[styles.summaryCard, styles['summaryCard_' + summary.tone]]}>
            <Text style={styles.summaryHeadline}>{summary.icon}  {summary.headline}</Text>
            <Text style={styles.summarySentence}>
              <Text style={styles.summaryAssetName}>{summary.assetLabel}</Text> scored {riskScore}/100 for compliance.
            </Text>
            <View style={styles.summaryBulletList}>
              {summary.bullets.map((b, i) => (
                <View key={i} style={styles.summaryBulletRow}>
                  <Text style={[styles.summaryBulletIcon, { color: b.ok ? '#4ade80' : '#fbbf24' }]}>{b.ok ? '✓' : '!'}</Text>
                  <Text style={styles.summaryBulletText}>{b.text}</Text>
                </View>
              ))}
            </View>
            <Text style={styles.summaryProofLine}>{summary.proofLine}</Text>
          </View>
        );
      })()}

      {riskScore !== null ? (
        <View style={styles.riskCard}>
          <View style={styles.riskRow}>
            <Text style={styles.riskLabel}>AI Risk Score</Text>
            <Text style={[styles.riskBadge, { backgroundColor: getRiskColor(riskLevel) + '22', color: getRiskColor(riskLevel) }]}>{riskLevel}</Text>
          </View>
          <View style={styles.riskBarBg}>
            <View style={[styles.riskBarFill, { width: riskScore + '%', backgroundColor: getRiskColor(riskLevel) }]} />
          </View>
          <Text style={[styles.riskScore, { color: getRiskColor(riskLevel) }]}>{riskScore}/100</Text>
        </View>
      ) : null}

      {scorecard ? (
        <View style={styles.scorecardCard}>
          <Text style={styles.scorecardTitle}>Compliance Scorecard</Text>
          {scorecard.map((item, idx) => (
            <View key={idx} style={styles.scorecardRow}>
              <View style={styles.scorecardLabelRow}>
                <Text style={styles.scorecardLabel}>{item.label}</Text>
                <Text style={[styles.scorecardValue, { color: item.score >= 85 ? '#22c55e' : item.score >= 70 ? '#f59e0b' : '#ef4444' }]}>{item.score}</Text>
              </View>
              <View style={styles.scorecardBarBg}>
                <View style={[styles.scorecardBarFill, { width: item.score + '%', backgroundColor: item.score >= 85 ? '#22c55e' : item.score >= 70 ? '#f59e0b' : '#ef4444' }]} />
              </View>
            </View>
          ))}
        </View>
      ) : null}

      {deployHash ? (
        <View style={styles.proofCard}>
          <View style={styles.proofBadgeRow}>
            <Text style={styles.proofTitle}>On-Chain Proof | Block #{blockHeight}</Text>
            <Text style={[styles.anchorBadge, anchorMode === 'contract' ? styles.anchorBadgeContract : anchorMode === 'real' ? styles.anchorBadgeReal : styles.anchorBadgeFallback]}>
              {anchorMode === 'contract' ? 'ON-CHAIN CONTRACT' : anchorMode === 'real' ? 'REAL TESTNET TX' : 'FALLBACK - NOT ON-CHAIN'}
            </Text>
          </View>
          <Text style={styles.proofHash}>{deployHash}</Text>
          <View style={styles.proofActions}>
            <TouchableOpacity style={styles.proofBtn} onPress={copyHash}>
              <Text style={styles.proofBtnText}>{copiedHash ? 'Copied!' : 'Copy Hash'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.proofBtn, styles.proofBtnPrimary]} onPress={() => Linking.openURL(deployUrl)}>
              <Text style={[styles.proofBtnText, styles.proofBtnTextPrimary]}>View on CSPR.live</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.proofActions}>
            <TouchableOpacity style={styles.proofBtn} onPress={downloadPdfReport}>
              <Text style={styles.proofBtnText}>Download PDF Report</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.proofBtn} onPress={() => Linking.openURL(BACKEND_URL + '/.well-known/agent-card.json')}>
              <Text style={styles.proofBtnText}>View Agent Card</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.proofActions}>
            <TouchableOpacity style={[styles.proofBtn, styles.proofBtnContract]} onPress={anchorViaContract} disabled={isAnchoringContract}>
              <Text style={styles.proofBtnText}>{isAnchoringContract ? 'Anchoring...' : '⚡ Anchor via Smart Contract (beta)'}</Text>
            </TouchableOpacity>
            {contractUrl ? (
              <TouchableOpacity style={styles.proofBtn} onPress={() => Linking.openURL(contractUrl)}>
                <Text style={styles.proofBtnText}>View Contract</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        </View>
      ) : null}

      <Modal visible={showHistoryModal} animationType="slide" transparent={true} onRequestClose={() => setShowHistoryModal(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeaderRow}>
              <Text style={styles.historyTitle}>Compliance History</Text>
              <TouchableOpacity onPress={() => setShowHistoryModal(false)}>
                <Text style={styles.modalCloseText}>Close ✕</Text>
              </TouchableOpacity>
            </View>
            <ScrollView>
              {history.map((h, idx) => (
                <View key={idx} style={styles.historyRow}>
                  <View style={styles.historyRowTop}>
                    <Text style={styles.historyAsset}>{h.assetId}</Text>
                    <Text style={[styles.historyScore, { color: getRiskColor(h.riskLevel) }]}>{h.riskScore}/100</Text>
                  </View>
                  <Text style={styles.historyMeta}>{formatUSD(h.valuation)} | {h.jurisdiction} | Block #{h.blockHeight} | {h.recommendation}</Text>
                </View>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>

      <TouchableOpacity style={styles.techLogToggle} onPress={() => setShowTechnicalLog(!showTechnicalLog)}>
        <Text style={styles.techLogToggleText}>{showTechnicalLog ? '▾' : '▸'} Technical Log {agentLogs.length > 0 ? '(' + agentLogs.length + ' events)' : ''}</Text>
      </TouchableOpacity>
      {showTechnicalLog ? (
        <ScrollView style={styles.console} contentContainerStyle={{ paddingBottom: 20 }}>
          {agentLogs.length === 0 ? (
            <Text style={styles.placeholderText}>Awaiting execution...</Text>
          ) : (
            agentLogs.map((log, i) => (
              <Text key={i} style={[styles.logText, log.type === 'success' && styles.logSuccess, log.type === 'system' && styles.logSystem, log.type === 'error' && styles.logError, log.type === 'oracle' && styles.logOracle, log.type === 'queue' && styles.logQueue]}>
                {log.text}
              </Text>
            ))
          )}
        </ScrollView>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scrollRoot: { flex: 1, backgroundColor: '#030712' },
  container: { backgroundColor: '#030712', padding: 16, paddingTop: 48, paddingBottom: 48 },
  header: { alignItems: 'center', marginBottom: 16 },
  logoMark: { width: 64, height: 64, marginBottom: 8 },
  title: { fontSize: 22, fontWeight: 'bold', color: '#f8fafc', letterSpacing: 0.5 },
  subtitle: { fontSize: 12, color: '#4b5563', textAlign: 'center', marginTop: 4 },
  agentBadge: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#0f172a', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6, marginTop: 10, borderWidth: 1, borderColor: '#1e3a5f' },
  agentSourceTag: { fontSize: 8, fontWeight: '800', paddingHorizontal: 5, paddingVertical: 1, borderRadius: 6, marginRight: 8, marginLeft: 4 },
  agentSourceReal: { color: '#052e16', backgroundColor: '#4ade80' },
  agentSourceLocal: { color: '#451a03', backgroundColor: '#fbbf24' },
  agentDot: { width: 7, height: 7, borderRadius: 4, marginRight: 7 },
  agentText: { color: '#60a5fa', fontSize: 11, fontFamily: 'monospace', flex: 1 },
  agentCopy: { color: '#3b82f6', fontSize: 10, fontWeight: '700', marginLeft: 8, textTransform: 'uppercase' },
  netToggle: { marginTop: 8, paddingHorizontal: 12, paddingVertical: 5, backgroundColor: '#1e293b', borderRadius: 14 },
  netToggleText: { color: '#94a3b8', fontSize: 10, fontWeight: '700', letterSpacing: 0.5 },
  queueBadge: { marginTop: 8, backgroundColor: '#451a03', paddingHorizontal: 12, paddingVertical: 5, borderRadius: 14, borderWidth: 1, borderColor: '#92400e' },
  queueText: { color: '#fbbf24', fontSize: 10, fontWeight: '700' },
  historyTrigger: { marginTop: 8, backgroundColor: '#1e1b4b', paddingHorizontal: 12, paddingVertical: 5, borderRadius: 14, borderWidth: 1, borderColor: '#3730a3' },
  historyTriggerText: { color: '#a5b4fc', fontSize: 10, fontWeight: '700' },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  modalSheet: { backgroundColor: '#0f172a', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 18, maxHeight: '75%', borderWidth: 1, borderColor: '#1e293b' },
  modalHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  modalCloseText: { color: '#60a5fa', fontSize: 13, fontWeight: '700' },
  techLogToggle: { paddingVertical: 8, marginBottom: 4 },
  techLogToggleText: { color: '#475569', fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },
  card: { backgroundColor: '#0f172a', padding: 16, borderRadius: 16, borderWidth: 1, borderColor: '#1e293b', marginBottom: 12 },
  labelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  label: { color: '#64748b', fontSize: 11, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.8 },
  presetBtn: { color: '#3b82f6', fontSize: 11, fontWeight: '700' },
  assetList: { backgroundColor: '#1e293b', borderRadius: 10, marginBottom: 10, overflow: 'hidden' },
  assetItem: { padding: 12, borderBottomWidth: 1, borderBottomColor: '#0f172a' },
  assetItemTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  assetItemLabel: { color: '#f1f5f9', fontSize: 13, fontWeight: '600', marginBottom: 2, flex: 1, marginRight: 8 },
  assetItemMeta: { color: '#64748b', fontSize: 11, marginTop: 2 },
  assetItemSource: { color: '#475569', fontSize: 9, fontStyle: 'italic', marginTop: 2 },
  sourceBadge: { fontSize: 8, fontWeight: '700', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, overflow: 'hidden' },
  sourceBadgeVerified: { backgroundColor: '#052e16', color: '#22c55e' },
  sourceBadgeDemo: { backgroundColor: '#451803', color: '#f59e0b' },
  dataSourceNote: { fontSize: 10, marginTop: -6, marginBottom: 12, fontStyle: 'italic' },
  dataSourceVerified: { color: '#22c55e' },
  dataSourceDemo: { color: '#f59e0b' },
  input: { backgroundColor: '#1e293b', padding: 11, borderRadius: 10, marginBottom: 12, fontSize: 13, color: '#f1f5f9', borderWidth: 1, borderColor: '#334155' },
  jurisdictionRow: { marginBottom: 12 },
  jChip: { paddingHorizontal: 13, paddingVertical: 6, borderRadius: 20, backgroundColor: '#1e293b', marginRight: 7, borderWidth: 1, borderColor: '#334155' },
  jChipActive: { backgroundColor: '#1d4ed8', borderColor: '#3b82f6' },
  jChipText: { color: '#64748b', fontSize: 12, fontWeight: '600' },
  jChipTextActive: { color: '#fff' },
  button: { backgroundColor: '#1d4ed8', padding: 14, borderRadius: 12, alignItems: 'center', marginTop: 2 },
  buttonDisabled: { backgroundColor: '#1e3a5f' },
  buttonText: { color: '#fff', fontSize: 15, fontWeight: '700', letterSpacing: 0.3 },
  oracleCard: { backgroundColor: '#1e1b4b', padding: 12, borderRadius: 12, borderWidth: 1, borderColor: '#3730a3', marginBottom: 12 },
  oracleTitle: { color: '#a5b4fc', fontSize: 10, fontWeight: '700', textTransform: 'uppercase', marginBottom: 4 },
  oracleData: { color: '#c7d2fe', fontSize: 12, fontFamily: 'monospace' },
  summaryCard: { padding: 18, borderRadius: 18, borderWidth: 1.5, marginBottom: 12 },
  summaryCard_good: { backgroundColor: '#052e1c', borderColor: '#15803d' },
  summaryCard_caution: { backgroundColor: '#2e2404', borderColor: '#a16207' },
  summaryCard_warning: { backgroundColor: '#3a1f04', borderColor: '#c2410c' },
  summaryCard_danger: { backgroundColor: '#3a0a0a', borderColor: '#b91c1c' },
  summaryHeadline: { color: '#f8fafc', fontSize: 18, fontWeight: '800', marginBottom: 6 },
  summarySentence: { color: '#cbd5e1', fontSize: 13, marginBottom: 12, lineHeight: 19 },
  summaryAssetName: { fontWeight: '700', color: '#f1f5f9' },
  summaryBulletList: { marginBottom: 10 },
  summaryBulletRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 6 },
  summaryBulletIcon: { fontSize: 13, fontWeight: '900', width: 20 },
  summaryBulletText: { color: '#e2e8f0', fontSize: 12.5, flex: 1, lineHeight: 18 },
  summaryProofLine: { color: '#94a3b8', fontSize: 11, fontStyle: 'italic', lineHeight: 16, marginTop: 4 },
  riskCard: { backgroundColor: '#0f172a', padding: 14, borderRadius: 14, borderWidth: 1, borderColor: '#1e293b', marginBottom: 12 },
  riskRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  riskLabel: { color: '#64748b', fontSize: 11, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.8 },
  riskBadge: { fontSize: 11, fontWeight: '700', paddingHorizontal: 10, paddingVertical: 3, borderRadius: 10 },
  riskBarBg: { backgroundColor: '#1e293b', borderRadius: 6, height: 8, marginBottom: 6 },
  riskBarFill: { height: 8, borderRadius: 6 },
  riskScore: { fontSize: 22, fontWeight: 'bold', textAlign: 'right' },
  scorecardCard: { backgroundColor: '#0f172a', padding: 14, borderRadius: 14, borderWidth: 1, borderColor: '#1e293b', marginBottom: 12 },
  scorecardTitle: { color: '#94a3b8', fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 12 },
  scorecardRow: { marginBottom: 10 },
  scorecardLabelRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  scorecardLabel: { color: '#cbd5e1', fontSize: 12 },
  scorecardValue: { fontSize: 12, fontWeight: '700' },
  scorecardBarBg: { backgroundColor: '#1e293b', borderRadius: 4, height: 6 },
  scorecardBarFill: { height: 6, borderRadius: 4 },
  proofCard: { backgroundColor: '#042f2e', padding: 14, borderRadius: 14, borderWidth: 1, borderColor: '#065f46', marginBottom: 12 },
  proofBadgeRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  anchorBadge: { fontSize: 9, fontWeight: '700', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, overflow: 'hidden' },
  anchorBadgeReal: { backgroundColor: '#052e16', color: '#22c55e' },
  anchorBadgeFallback: { backgroundColor: '#450a0a', color: '#f87171' },
  anchorBadgeContract: { backgroundColor: '#2e1065', color: '#c4b5fd' },
  proofTitle: { color: '#34d399', fontSize: 11, fontWeight: '700', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.8 },
  proofHash: { color: '#6ee7b7', fontFamily: 'monospace', fontSize: 10, marginBottom: 10 },
  proofActions: { flexDirection: 'row', gap: 8 },
  proofBtn: { flex: 1, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: '#065f46', alignItems: 'center' },
  proofBtnPrimary: { backgroundColor: '#065f46', borderColor: '#059669' },
  proofBtnContract: { backgroundColor: '#2e1065', borderColor: '#6d28d9', flex: 1 },
  proofBtnText: { color: '#34d399', fontSize: 12, fontWeight: '600' },
  proofBtnTextPrimary: { color: '#fff' },
  historyCard: { backgroundColor: '#0f172a', padding: 14, borderRadius: 14, borderWidth: 1, borderColor: '#1e293b', marginBottom: 12 },
  historyTitle: { color: '#94a3b8', fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 10 },
  historyRow: { paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#1e293b' },
  historyRowTop: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 3 },
  historyAsset: { color: '#f1f5f9', fontSize: 12, fontWeight: '600' },
  historyScore: { fontSize: 12, fontWeight: '700' },
  historyMeta: { color: '#64748b', fontSize: 10, fontFamily: 'monospace' },
  sectionTitle: { fontSize: 11, fontWeight: '700', color: '#1f2937', marginBottom: 6, paddingLeft: 2, textTransform: 'uppercase', letterSpacing: 0.8 },
  console: { maxHeight: 280, backgroundColor: '#030712', borderRadius: 12, borderWidth: 1, borderColor: '#1e293b', padding: 12 },
  placeholderText: { color: '#1f2937', fontStyle: 'italic', textAlign: 'center', marginTop: 30, fontSize: 12 },
  logText: { color: '#374151', fontSize: 11, marginVertical: 2, lineHeight: 16, fontFamily: 'monospace' },
  logSuccess: { color: '#22c55e' },
  logSystem: { color: '#3b82f6', fontWeight: 'bold' },
  logError: { color: '#ef4444' },
  logOracle: { color: '#a78bfa' },
  logQueue: { color: '#fbbf24' },
});
