/*********************************************************
 KONFIGURASI MQTT
*********************************************************/
const mqttConfig = {
  host: "wss://7b066e0e6f1343a3a136ee482b8ce5b0.s1.eu.hivemq.cloud:8884/mqtt",
  username: "Penyiraman_Tanaman_Otomatis",
  password: "Penyiramm1144*"
};

const client = mqtt.connect(mqttConfig.host, {
  username: mqttConfig.username,
  password: mqttConfig.password,
  reconnectPeriod: 2000,
  clean: true
});

/*********************************************************
 ELEMEN DOM
*********************************************************/
const elements = {
  mqttStatus: document.getElementById("mqttStatus"),
  espStatus: document.getElementById("espStatus"),
  lastUpdate: document.getElementById("lastUpdate"),
  soil1: document.getElementById("soil1"),
  soil2: document.getElementById("soil2"),
  soilAvg: document.getElementById("soilAvg"),
  soil1Progress: document.getElementById("soil1Progress"),
  soil2Progress: document.getElementById("soil2Progress"),
  soilAvgProgress: document.getElementById("soilAvgProgress"),
  battVolt: document.getElementById("battVolt"),
  battCurr: document.getElementById("battCurr"),
  battPower: document.getElementById("battPower"),
  panelVolt: document.getElementById("panelVolt"),
  panelCurr: document.getElementById("panelCurr"),
  panelPower: document.getElementById("panelPower"),
  mode: document.getElementById("mode"),
  pompaStatus: document.getElementById("pompaStatus"),
  batteryPercent: document.getElementById("batteryPercent"),
  batteryProgress: document.getElementById("batteryProgress"),
  lightIntensity: document.getElementById("lightIntensity"),
  modeStatus: document.getElementById("modeStatus"),
  thresholdOnVal: document.getElementById("thresholdOnVal"),
  thresholdOffVal: document.getElementById("thresholdOffVal"),
  thresholdNote: document.getElementById("thresholdNote"),
  pumpStatusCard: document.getElementById("pumpStatusCard"),
  pumpStatusIcon: document.getElementById("pumpStatusIcon"),
  pumpStatusLabel: document.getElementById("pumpStatusLabel"),
  pumpStatusDesc: document.getElementById("pumpStatusDesc")
};

/*********************************************************
 VARIABEL
*********************************************************/
let lastHeartbeat = 0;
let everOnline = false;
let currentMode = "MANUAL";
let currentPumpState = false; // false = OFF, true = ON
let currentSoilAvg = 0;
let pumpOnThreshold = 65;
let pumpOffThreshold = 70;

/*********************************************************
 CHART
*********************************************************/
const ctx = document.getElementById("soilChart").getContext("2d");
const soilChart = new Chart(ctx, {
  type: "line",
  data: {
    labels: [],
    datasets: [{
      label: "Kelembapan Rata-rata (%)",
      data: [],
      borderColor: "#27ae60",
      backgroundColor: "rgba(46, 204, 113, 0.1)",
      tension: 0.4,
      fill: true,
      pointRadius: 4,
      pointBackgroundColor: "#2ecc71",
      pointBorderColor: "#fff",
      pointBorderWidth: 2
    }]
  },
  options: {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { 
        labels: { 
          color: "#2c3e50",
          font: { weight: "bold" }
        } 
      }
    },
    scales: {
      y: { 
        min: 0, 
        max: 100, 
        grid: { color: "#e9ecef" }, 
        title: { display: true, text: "Kelembapan (%)", color: "#6c757d" } 
      },
      x: { 
        grid: { color: "#e9ecef" }, 
        title: { display: true, text: "Waktu", color: "#6c757d" } 
      }
    }
  }
});

/*********************************************************
 FUNGSI BANTUAN
*********************************************************/
function formatTwoDecimals(value) {
  if (value === undefined || value === null || value === '--') return '--';
  const num = parseFloat(value);
  return isNaN(num) ? '--' : num.toFixed(2);
}

function formatNoDecimal(value) {
  if (value === undefined || value === null || value === '--') return '--';
  const num = parseFloat(value);
  return isNaN(num) ? '--' : Math.round(num).toString();
}

function voltageToBatteryPercent(voltage) {
  const minVolt = 10, maxVolt = 14.3;
  if (voltage <= minVolt) return 0;
  if (voltage >= maxVolt) return 100;
  return Math.round(((voltage - minVolt) / (maxVolt - minVolt)) * 100);
}

function voltageToLightIntensity(voltage, current, power) {
  const curr = parseFloat(current);
  const pow = parseFloat(power);
  
  if (curr <= 0 || pow <= 0) return 0;
  
  const voltValue = parseFloat(voltage) || 0;
  if (voltValue <= 0.1) return 0;
  if (voltValue < 12) return Math.round((voltValue / 12) * 100);
  if (voltValue <= 18) return Math.round(100 + ((voltValue - 12) / 6) * 900);
  return 1000;
}

/*********************************************************
 UPDATE THRESHOLD DISPLAY
*********************************************************/
function updateThresholdDisplay() {
  if (elements.thresholdOnVal) {
    elements.thresholdOnVal.textContent = pumpOnThreshold;
  }
  if (elements.thresholdOffVal) {
    elements.thresholdOffVal.textContent = pumpOffThreshold;
  }
  
  const onRange = document.getElementById("onRange");
  const optimalRange = document.getElementById("optimalRange");
  const offRange = document.getElementById("offRange");
  
  if (onRange && optimalRange && offRange) {
    const onWidth = pumpOnThreshold;
    const offWidth = 100 - pumpOffThreshold;
    const optimalWidth = pumpOffThreshold - pumpOnThreshold;
    
    onRange.style.width = onWidth + "%";
    optimalRange.style.width = optimalWidth + "%";
    offRange.style.width = offWidth + "%";
  }
  
  if (elements.thresholdNote) {
    elements.thresholdNote.innerHTML = `<i class="fas fa-info-circle"></i> 
      Pompa menyala otomatis jika kelembapan ≤ ${pumpOnThreshold}% (zona merah) dan 
      mati jika kelembapan ≥ ${pumpOffThreshold}% (zona hijau)`;
  }
  
  updatePumpStatusDisplay();
}

/*********************************************************
 UPDATE PUMP STATUS - SINKRON DENGAN STATUS SEBENARNYA
*********************************************************/
function updatePumpStatusDisplay() {
  // 1. Update status di pump-box (bawah)
  if (elements.pompaStatus) {
    const pumpStateText = currentPumpState ? "ON" : "OFF";
    elements.pompaStatus.textContent = pumpStateText;
    
    // Update warna teks status pompa
    if (currentPumpState) {
      elements.pompaStatus.classList.add("pump-on");
      elements.pompaStatus.classList.remove("pump-off");
    } else {
      elements.pompaStatus.classList.add("pump-off");
      elements.pompaStatus.classList.remove("pump-on");
    }
  }
  
  // 2. Update status card (atas) sesuai dengan status pompa sebenarnya
  if (elements.pumpStatusCard) {
    // Hapus class sebelumnya
    elements.pumpStatusCard.classList.remove("pump-on", "pump-off");
    
    if (currentPumpState) {
      // Pompa ON
      elements.pumpStatusCard.classList.add("pump-on");
      elements.pumpStatusIcon.className = "fas fa-water-pump running";
      elements.pumpStatusLabel.className = "pump-status-label pump-on";
      elements.pumpStatusLabel.textContent = "💧 POMPA SEDANG MENYALA";
      
      if (currentSoilAvg <= pumpOnThreshold) {
        elements.pumpStatusDesc.textContent = `Kelembapan ${currentSoilAvg}% ≤ ${pumpOnThreshold}% - Pompa aktif melakukan penyiraman`;
      } else if (currentMode === "MANUAL") {
        elements.pumpStatusDesc.textContent = `Pompa diaktifkan secara manual melalui dashboard`;
      } else {
        elements.pumpStatusDesc.textContent = `Pompa sedang menyala - Menyiram tanaman`;
      }
    } else {
      // Pompa OFF
      elements.pumpStatusCard.classList.add("pump-off");
      elements.pumpStatusIcon.className = "fas fa-water-pump stopped";
      elements.pumpStatusLabel.className = "pump-status-label pump-off";
      elements.pumpStatusLabel.textContent = "⏹️ POMPA DALAM KEADAAN MATI";
      
      if (currentSoilAvg >= pumpOffThreshold) {
        elements.pumpStatusDesc.textContent = `Kelembapan ${currentSoilAvg}% ≥ ${pumpOffThreshold}% - Tanah sudah cukup lembap, pompa berhenti`;
      } else if (currentSoilAvg > pumpOnThreshold && currentSoilAvg < pumpOffThreshold) {
        elements.pumpStatusDesc.textContent = `Kelembapan ${currentSoilAvg}% dalam zona optimal (${pumpOnThreshold}%-${pumpOffThreshold}%) - Tidak perlu menyiram`;
      } else if (currentMode === "MANUAL") {
        elements.pumpStatusDesc.textContent = `Pompa dimatikan secara manual melalui dashboard`;
      } else {
        elements.pumpStatusDesc.textContent = `Pompa dalam keadaan mati - Menunggu kondisi kelembapan ≤ ${pumpOnThreshold}%`;
      }
    }
  }
  
  // 3. Highlight zona threshold berdasarkan nilai kelembapan
  const onRange = document.getElementById("onRange");
  const optimalRange = document.getElementById("optimalRange");
  const offRange = document.getElementById("offRange");
  
  if (onRange && optimalRange && offRange) {
    onRange.style.opacity = "0.6";
    optimalRange.style.opacity = "0.6";
    offRange.style.opacity = "0.6";
    onRange.style.boxShadow = "none";
    optimalRange.style.boxShadow = "none";
    offRange.style.boxShadow = "none";
    
    if (currentSoilAvg <= pumpOnThreshold) {
      onRange.style.opacity = "1";
      onRange.style.boxShadow = "0 0 15px rgba(239,68,68,0.6)";
    } else if (currentSoilAvg >= pumpOffThreshold) {
      offRange.style.opacity = "1";
      offRange.style.boxShadow = "0 0 15px rgba(16,185,129,0.6)";
    } else if (currentSoilAvg > 0) {
      optimalRange.style.opacity = "1";
      optimalRange.style.boxShadow = "0 0 15px rgba(245,158,11,0.6)";
    }
  }
}

/*********************************************************
 UPDATE MODE STATUS TEXT
*********************************************************/
function updateModeStatusText() {
  if (elements.modeStatus) {
    if (currentMode === "AUTO") {
      elements.modeStatus.innerHTML = '<i class="fas fa-robot"></i> Mode Auto: Pompa dikontrol otomatis berdasarkan kelembapan tanah';
      elements.modeStatus.style.background = "#e8f5e9";
      elements.modeStatus.style.color = "#2e7d32";
      elements.modeStatus.classList.remove("manual");
      elements.modeStatus.classList.add("auto");
    } else {
      elements.modeStatus.innerHTML = '<i class="fas fa-hand-paper"></i> Mode Manual: Gunakan tombol ON/OFF untuk kontrol pompa';
      elements.modeStatus.style.background = "#fff3e0";
      elements.modeStatus.style.color = "#e65100";
      elements.modeStatus.classList.remove("auto");
      elements.modeStatus.classList.add("manual");
    }
  }
}

/*********************************************************
 UPDATE CHART
*********************************************************/
function addSoilData(val) {
  const time = new Date().toLocaleTimeString();
  soilChart.data.labels.push(time);
  soilChart.data.datasets[0].data.push(val);
  if (soilChart.data.labels.length > 20) {
    soilChart.data.labels.shift();
    soilChart.data.datasets[0].data.shift();
  }
  soilChart.update();
  if (elements.lastUpdate) elements.lastUpdate.textContent = time;
}

/*********************************************************
 MQTT EVENTS
*********************************************************/
client.on("connect", () => {
  if (elements.mqttStatus) {
    elements.mqttStatus.textContent = "TERHUBUNG";
    elements.mqttStatus.style.color = "#27ae60";
  }
  client.subscribe("irrigation/#");
  console.log("MQTT Connected, subscribed to irrigation/#");
});

client.on("offline", () => {
  if (elements.mqttStatus) {
    elements.mqttStatus.textContent = "PUTUS";
    elements.mqttStatus.style.color = "#e74c3c";
  }
  console.log("MQTT Disconnected");
});

client.on("error", (err) => {
  console.error("MQTT Error:", err);
});

/*********************************************************
 MESSAGE HANDLER
*********************************************************/
client.on("message", (topic, message) => {
  const data = message.toString();
  console.log("Received:", topic, data);

  // Heartbeat
  if (topic === "irrigation/heartbeat") {
    lastHeartbeat = Date.now();
    everOnline = true;
    if (elements.espStatus) {
      elements.espStatus.textContent = "ONLINE";
      elements.espStatus.style.color = "#27ae60";
    }
    return;
  }

  // Threshold ON
  if (topic === "irrigation/threshold/pompa_on") {
    pumpOnThreshold = parseInt(data) || 65;
    updateThresholdDisplay();
    console.log("Threshold ON:", pumpOnThreshold);
    return;
  }

  // Threshold OFF
  if (topic === "irrigation/threshold/pompa_off") {
    pumpOffThreshold = parseInt(data) || 70;
    updateThresholdDisplay();
    console.log("Threshold OFF:", pumpOffThreshold);
    return;
  }

  // Sensor soil 1
  if (topic === "irrigation/soil1") {
    const val = Number(data);
    if (elements.soil1) elements.soil1.innerHTML = val + "<span>%</span>";
    if (elements.soil1Progress) elements.soil1Progress.style.width = val + "%";
    return;
  }

  // Sensor soil 2
  if (topic === "irrigation/soil2") {
    const val = Number(data);
    if (elements.soil2) elements.soil2.innerHTML = val + "<span>%</span>";
    if (elements.soil2Progress) elements.soil2Progress.style.width = val + "%";
    return;
  }

  // Soil average
  if (topic === "irrigation/soil") {
    currentSoilAvg = Number(data);
    if (elements.soilAvg) elements.soilAvg.innerHTML = currentSoilAvg + "<span>%</span>";
    if (elements.soilAvgProgress) elements.soilAvgProgress.style.width = currentSoilAvg + "%";
    addSoilData(currentSoilAvg);
    updatePumpStatusDisplay();
    return;
  }

  // Baterai - Tegangan
  if (topic === "irrigation/battery/voltage") {
    if (elements.battVolt) elements.battVolt.textContent = formatTwoDecimals(data);
    const percent = voltageToBatteryPercent(parseFloat(data) || 0);
    if (elements.batteryPercent) elements.batteryPercent.textContent = percent + "%";
    if (elements.batteryProgress) elements.batteryProgress.style.width = percent + "%";
    return;
  }

  // Baterai - Arus
  if (topic === "irrigation/battery/current") {
    if (elements.battCurr) elements.battCurr.textContent = formatNoDecimal(data);
    return;
  }

  // Baterai - Daya
  if (topic === "irrigation/battery/power") {
    if (elements.battPower) elements.battPower.textContent = formatTwoDecimals(data);
    return;
  }

  // Panel surya - Tegangan
  if (topic === "irrigation/panel/voltage") {
    if (elements.panelVolt) elements.panelVolt.textContent = formatTwoDecimals(data);
    return;
  }

  // Panel surya - Arus
  if (topic === "irrigation/panel/current") {
    if (elements.panelCurr) elements.panelCurr.textContent = formatNoDecimal(data);
    return;
  }

  // Panel surya - Daya
  if (topic === "irrigation/panel/power") {
    if (elements.panelPower) elements.panelPower.textContent = formatTwoDecimals(data);
    const volt = elements.panelVolt ? parseFloat(elements.panelVolt.textContent) : 0;
    const intensity = voltageToLightIntensity(volt, data, data);
    if (elements.lightIntensity) {
      elements.lightIntensity.textContent = intensity + " W/m²";
    }
    const solarInfo = document.getElementById("solarInfo");
    if (solarInfo && intensity === 0) {
      solarInfo.style.background = "#ffebee";
      solarInfo.style.borderColor = "#ef9a9a";
    } else if (solarInfo) {
      solarInfo.style.background = "#fff8e1";
      solarInfo.style.borderColor = "#ffe082";
    }
    return;
  }

  // Mode (AUTO/MANUAL)
  if (topic === "irrigation/mode") {
    currentMode = data === "1" ? "AUTO" : "MANUAL";
    if (elements.mode) elements.mode.textContent = currentMode;
    updateModeStatusText();
    updatePumpStatusDisplay();
    console.log("Mode:", currentMode);
    return;
  }

  // Status Pompa (dari ESP32)
  if (topic === "irrigation/pump") {
    currentPumpState = data === "1";
    if (elements.pompaStatus) {
      elements.pompaStatus.textContent = currentPumpState ? "ON" : "OFF";
    }
    updatePumpStatusDisplay();
    console.log("Pump State:", currentPumpState ? "ON" : "OFF");
    return;
  }
});

/*********************************************************
 CHECK ESP32 ONLINE
*********************************************************/
setInterval(() => {
  const now = Date.now();
  if (!everOnline && now > 5000) {
    if (elements.espStatus) {
      elements.espStatus.textContent = "OFFLINE";
      elements.espStatus.style.color = "#e74c3c";
    }
  }
  if (everOnline && now - lastHeartbeat > 6000) {
    if (elements.espStatus) {
      elements.espStatus.textContent = "OFFLINE";
      elements.espStatus.style.color = "#e74c3c";
    }
    everOnline = false;
  }
}, 1000);

/*********************************************************
 FUNGSI KONTROL
*********************************************************/
function toggleMode() {
  client.publish("irrigation/cmd/mode", "TOGGLE");
  console.log("Toggle mode sent");
}

function setPump(state) {
  client.publish("irrigation/cmd/pump", state);
  console.log("Set pump:", state);
}

/*********************************************************
 INITIALISASI
*********************************************************/
updateThresholdDisplay();
updateModeStatusText();
updatePumpStatusDisplay();

console.log("Dashboard ready, waiting for MQTT data...");