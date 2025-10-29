import { db, auth } from "./firebaseConfig.js";
import { signInAnonymously, onAuthStateChanged } from "firebase/auth";
import {
  collection,
  addDoc,
  orderBy,
  query,
  serverTimestamp,
  doc,
  deleteDoc,
  updateDoc,
  limit,
  startAfter,
  getCountFromServer,
  getDocs,
  where,
  sum,
  getAggregateFromServer,
  Timestamp,
} from "firebase/firestore";
import Chart from "chart.js/auto";

// --- DOM ELEMENTS ---
const transactionList = document.getElementById("transaction-list");
const totalIncomeEl = document.getElementById("total-income");
const totalExpensesEl = document.getElementById("total-expenses");
const netProfitEl = document.getElementById("net-profit");
const taxSavedAmountEl = document.getElementById("tax-saved-amount");
const profitProgressBar = document.getElementById("profit-bar");
const lossProgressBar = document.getElementById("loss-bar");
const profitMarginText = document.getElementById("profit-margin-text");
const prevPageBtn = document.getElementById("prev-page-btn");
const nextPageBtn = document.getElementById("next-page-btn");
const pageInfoEl = document.getElementById("page-info");
const transactionForm = document.getElementById("transaction-form");
const typeDropdown = document.getElementById("type");
const categoryDropdown = document.getElementById("category");
const mainFilters = document.getElementById("main-filters");
const categoryFilters = document.getElementById("category-filters");
const categoryFilterDropdown = document.getElementById("category-filter");
const editModal = document.getElementById("edit-modal");
const editForm = document.getElementById("edit-form");
const closeModalBtn = document.getElementById("close-modal-btn");
const cancelEditBtn = document.getElementById("cancel-edit-btn");
const editTypeDropdown = document.getElementById("edit-type");
const editCategoryGroup = document.getElementById("edit-category-group");
const savingsRecommendedAmountEl = document.getElementById(
  "savings-recommended-amount"
);
const availableBalanceEl = document.getElementById("available-balance");
const reportsBtn = document.getElementById("reports-btn");
const reportsModal = document.getElementById("reports-modal");
const closeReportsModalBtn = document.getElementById("close-reports-modal-btn");
const timePeriodFilter = document.getElementById("time-period-filter");
const chartCanvas = document.getElementById("transactions-chart");
const customDateRangeEl = document.getElementById("custom-date-range");
const startDateInput = document.getElementById("start-date");
const endDateInput = document.getElementById("end-date");
const aiSummaryContent = document.getElementById("ai-summary-content");

// --- CONSTANTS AND STATE ---
const TAX_RATE = 0.25;
const SAVINGS_RATE = 0.2;
let transactions = [];
const TRANSACTIONS_PER_PAGE = 10;
let currentPage = 1;
let totalPages = 1;
let isFetching = false;
let pageCursors = [null];
let currentFilter = { type: "all" };
let transactionsChart = null;
const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY;

// --- HELPER FUNCTIONS ---
function formatCurrency(number) {
  if (typeof number !== "number") {
    number = 0;
  }
  return number.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
function createTimezoneSafeDate(dateString) {
  return new Date(dateString + "T12:00:00Z");
}
function getTodayDateString() {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
function getDateStringDaysAgo(days) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().split("T")[0];
}
function getStartOfWeek(date) {
  const d = new Date(date.getTime());
  const day = d.getUTCDay();
  const diff = d.getUTCDate() - day;
  return new Date(d.setUTCDate(diff));
}
function getStartOfMonth(date) {
  const d = new Date(date.getTime());
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}
function getStartOfQuarter(date) {
  const d = new Date(date.getTime());
  const quarter = Math.floor(d.getUTCMonth() / 3);
  return new Date(Date.UTC(d.getUTCFullYear(), quarter * 3, 1));
}
function getStartOfYear(date) {
  const d = new Date(date.getTime());
  return new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
}

// --- AUTHENTICATION FLOW ---
onAuthStateChanged(auth, (user) => {
  if (user) {
    initializeApp(user);
  } else {
    signInAnonymously(auth).catch((error) =>
      console.error("Anonymous sign-in failed:", error)
    );
  }
});

// --- CORE APPLICATION LOGIC ---
async function initializeApp(user) {
  const userId = user.uid;
  const transactionsCollection = collection(
    db,
    "users",
    userId,
    "transactions"
  );

  // --- QUERY BUILDER ---
  const buildQuery = (isAggregation = false) => {
    let constraints = [];
    if (currentFilter.type === "income") {
      constraints.push(where("type", "==", "income"));
    } else if (currentFilter.type === "expense") {
      constraints.push(where("type", "==", "expense"));
      if (currentFilter.category && currentFilter.category !== "all") {
        constraints.push(where("category", "==", currentFilter.category));
      }
    }
    if (!isAggregation) {
      constraints.push(orderBy("date", "desc"), orderBy("createdAt", "desc"));
    }
    return query(transactionsCollection, ...constraints);
  };

  // --- DATA HANDLING FUNCTIONS ---
  const updateGlobalSummary = async () => {
    const allIncomesQuery = query(
      transactionsCollection,
      where("type", "==", "income")
    );
    const allExpensesQuery = query(
      transactionsCollection,
      where("type", "==", "expense")
    );
    try {
      const incomePromise = getAggregateFromServer(allIncomesQuery, {
        totalIncome: sum("amount"),
      });
      const expensePromise = getAggregateFromServer(allExpensesQuery, {
        totalExpenses: sum("amount"),
      });
      const [incomeSnapshot, expenseSnapshot] = await Promise.all([
        incomePromise,
        expensePromise,
      ]);
      const totalIncome = incomeSnapshot.data().totalIncome || 0;
      const totalExpenses = expenseSnapshot.data().totalExpenses || 0;
      const netProfit = totalIncome - totalExpenses;
      const taxToSave = totalIncome * TAX_RATE;
      const recommendedSavings = Math.max(0, netProfit * SAVINGS_RATE);
      const availableBalance = netProfit - taxToSave - recommendedSavings;
      totalIncomeEl.textContent = `$${formatCurrency(totalIncome)}`;
      totalExpensesEl.textContent = `$${formatCurrency(totalExpenses)}`;
      netProfitEl.textContent = `$${formatCurrency(netProfit)}`;
      taxSavedAmountEl.textContent = `$${formatCurrency(taxToSave)}`;
      savingsRecommendedAmountEl.textContent = `$${formatCurrency(
        recommendedSavings
      )}`;

      // JAVASCRIPT CHANGE: Logic to dynamically set the color of "Safe to Spend"
      // First, remove any existing color classes to reset the state
      availableBalanceEl.classList.remove(
        "income-color",
        "expense-color",
        "primary-color"
      );

      // Then, add the correct class based on the value
      if (availableBalance > 0) {
        availableBalanceEl.classList.add("income-color"); // Green for positive
      } else if (availableBalance < 0) {
        availableBalanceEl.classList.add("expense-color"); // Red for negative
      } else {
        availableBalanceEl.classList.add("primary-color"); // Blue for zero
      }

      availableBalanceEl.textContent = `$${formatCurrency(availableBalance)}`;

      let profitMargin =
        totalIncome > 0
          ? (netProfit / totalIncome) * 100
          : netProfit < 0
          ? -100
          : 0;
      profitMarginText.textContent = `${profitMargin.toFixed(0)}%`;
      if (profitMargin >= 0) {
        profitProgressBar.style.display = "block";
        lossProgressBar.style.display = "none";
        profitProgressBar.style.width = `${Math.min(100, profitMargin)}%`;
        profitMarginText.classList.remove("expense-color");
        profitMarginText.classList.add("income-color");
      } else {
        profitProgressBar.style.display = "none";
        lossProgressBar.style.display = "block";
        lossProgressBar.style.width = `${Math.min(
          100,
          Math.abs(profitMargin)
        )}%`;
        profitMarginText.classList.remove("income-color");
        profitMarginText.classList.add("expense-color");
      }
    } catch (e) {
      console.error("Error fetching aggregate summary:", e);
    }
  };

  const updateTotalPages = async () => {
    const q = buildQuery();
    try {
      const snapshot = await getCountFromServer(q);
      totalPages =
        Math.ceil(snapshot.data().count / TRANSACTIONS_PER_PAGE) || 1;
    } catch (e) {
      console.error("Error getting total transaction count:", e);
    }
  };

  const fetchTransactionsForPage = async (page) => {
    if (isFetching) return;
    isFetching = true;
    try {
      const cursor = pageCursors[page - 1];
      const baseQuery = buildQuery();
      let q = query(baseQuery, limit(TRANSACTIONS_PER_PAGE));
      if (cursor)
        q = query(baseQuery, startAfter(cursor), limit(TRANSACTIONS_PER_PAGE));
      const documentSnapshots = await getDocs(q);
      const lastDoc = documentSnapshots.docs[documentSnapshots.docs.length - 1];
      if (lastDoc) pageCursors[page] = lastDoc;
      transactions = documentSnapshots.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));
      renderTransactions();
      updatePaginationUI();
    } catch (e) {
      console.error("Error fetching transactions:", e);
    } finally {
      isFetching = false;
    }
  };

  const refreshData = async () => {
    await updateTotalPages();
    await fetchTransactionsForPage(currentPage);
  };
  const resetAndRefresh = async () => {
    currentPage = 1;
    pageCursors = [null];
    await refreshData();
  };

  const addTransaction = async (data) => {
    try {
      await addDoc(transactionsCollection, {
        ...data,
        createdAt: serverTimestamp(),
      });
      await updateGlobalSummary();
      await resetAndRefresh();
    } catch (e) {
      console.error("Error adding document: ", e);
    }
  };

  const deleteTransaction = async (transactionId) => {
    try {
      await deleteDoc(doc(db, "users", userId, "transactions", transactionId));
      await updateGlobalSummary();
      await updateTotalPages();
      if (
        currentPage > 1 &&
        transactions.length === 1 &&
        currentPage > totalPages
      ) {
        currentPage--;
      }
      const oldCursors = [...pageCursors];
      pageCursors = [null];
      for (let i = 1; i < currentPage; i++) {
        const cursor = oldCursors[i - 1];
        let q = query(buildQuery(), limit(TRANSACTIONS_PER_PAGE));
        if (cursor)
          q = query(
            buildQuery(),
            startAfter(cursor),
            limit(TRANSACTIONS_PER_PAGE)
          );
        const snapshot = await getDocs(q);
        const lastDoc = snapshot.docs[snapshot.docs.length - 1];
        if (lastDoc) pageCursors[i] = lastDoc;
        else break;
      }
      await fetchTransactionsForPage(currentPage);
    } catch (e) {
      console.error("Error removing document: ", e);
    }
  };

  const updateTransaction = async (transactionId, data) => {
    try {
      await updateDoc(
        doc(db, "users", userId, "transactions", transactionId),
        data
      );
      await updateGlobalSummary();
      await refreshData();
    } catch (e) {
      console.error("Error updating document:", e);
    }
  };

  const openEditModal = (transaction) => {
    editForm.elements["edit-id"].value = transaction.id;
    editForm.elements["edit-description"].value = transaction.description;
    editForm.elements["edit-amount"].value = transaction.amount;
    editForm.elements["edit-date"].value = transaction.date
      .toDate()
      .toISOString()
      .split("T")[0];
    editForm.elements["edit-type"].value = transaction.type;
    editCategoryGroup.classList.toggle(
      "hidden",
      transaction.type !== "expense"
    );
    if (transaction.type === "expense")
      editForm.elements["edit-category"].value =
        transaction.category || "other";
    editModal.classList.remove("hidden");
  };
  const closeEditModal = () => {
    editModal.classList.add("hidden");
    editForm.reset();
  };

  // --- AI AND CHART LOGIC ---
  const generateAISummary = async (rawData) => {
    aiSummaryContent.textContent = "Generating your financial summary...";
    aiSummaryContent.classList.add("loading");
    if (!GEMINI_API_KEY) {
      aiSummaryContent.textContent =
        "AI API key is missing. Please check your .env file.";
      aiSummaryContent.classList.remove("loading");
      return;
    }
    const totalIncome = rawData
      .filter((t) => t.type === "income")
      .reduce((sum, t) => sum + t.amount, 0);
    const totalExpenses = rawData
      .filter((t) => t.type === "expense")
      .reduce((sum, t) => sum + t.amount, 0);
    const netProfit = totalIncome - totalExpenses;
    let expenseBreakdown = {};
    rawData
      .filter((t) => t.type === "expense")
      .forEach((t) => {
        expenseBreakdown[t.category] =
          (expenseBreakdown[t.category] || 0) + t.amount;
      });
    const largestExpenseCategory = Object.keys(expenseBreakdown).reduce(
      (a, b) => (expenseBreakdown[a] > expenseBreakdown[b] ? a : b),
      null
    );
    const prompt = `You are a helpful and encouraging financial assistant for a freelancer. Based on the following data, write a short, insightful summary (3-4 sentences max). Be positive but also point out one area for improvement if applicable. Format the response as a single paragraph. Data: Total Income: ${formatCurrency(
      totalIncome
    )}, Total Expenses: ${formatCurrency(
      totalExpenses
    )}, Net Profit: ${formatCurrency(netProfit)}, Largest Expense Category: ${
      largestExpenseCategory || "None"
    }.`;

    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${GEMINI_API_KEY}`;

    try {
      const response = await fetch(apiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
      });
      if (!response.ok) {
        throw new Error(`API responded with status: ${response.status}`);
      }
      const result = await response.json();
      const summary = result.candidates[0].content.parts[0].text;
      aiSummaryContent.textContent = summary;
    } catch (error) {
      console.error("AI summary generation failed:", error);
      aiSummaryContent.textContent =
        "Could not generate AI summary at this time.";
    } finally {
      aiSummaryContent.classList.remove("loading");
    }
  };

  const fetchChartData = async (startDate, endDate) => {
    const startTimestamp = Timestamp.fromDate(
      createTimezoneSafeDate(startDate)
    );
    const endOfDay = new Date(endDate + "T23:59:59Z");
    const endTimestamp = Timestamp.fromDate(endOfDay);
    const q = query(
      transactionsCollection,
      where("date", ">=", startTimestamp),
      where("date", "<=", endTimestamp),
      orderBy("date", "asc")
    );
    try {
      const querySnapshot = await getDocs(q);
      return querySnapshot.docs.map((doc) => doc.data());
    } catch (e) {
      console.error("Error fetching chart data:", e);
      alert(
        "The chart requires a database index. Please check the browser console for a link to create it."
      );
      return [];
    }
  };

  const processChartData = (data, startDateStr, endDateStr) => {
    const groupedData = {};
    const start = createTimezoneSafeDate(startDateStr);
    const end = createTimezoneSafeDate(endDateStr);
    const dayCount = (end - start) / (1000 * 60 * 60 * 24) + 1;
    let aggregationType = "daily";
    if (dayCount > 365 * 2) {
      aggregationType = "yearly";
    } else if (dayCount > 730) {
      aggregationType = "quarterly";
    } else if (dayCount > 180) {
      aggregationType = "monthly";
    } else if (dayCount > 45) {
      aggregationType = "weekly";
    }
    let currentDate = new Date(start.getTime());
    while (currentDate <= end) {
      let keyDate;
      switch (aggregationType) {
        case "yearly":
          keyDate = getStartOfYear(currentDate);
          currentDate.setUTCFullYear(currentDate.getUTCFullYear() + 1);
          break;
        case "quarterly":
          keyDate = getStartOfQuarter(currentDate);
          currentDate.setUTCMonth(currentDate.getUTCMonth() + 3);
          break;
        case "monthly":
          keyDate = getStartOfMonth(currentDate);
          currentDate.setUTCMonth(currentDate.getUTCMonth() + 1);
          break;
        case "weekly":
          keyDate = getStartOfWeek(currentDate);
          currentDate.setUTCDate(currentDate.getUTCDate() + 7);
          break;
        default:
          keyDate = new Date(currentDate.getTime());
          currentDate.setUTCDate(currentDate.getUTCDate() + 1);
      }
      groupedData[keyDate.toISOString().split("T")[0]] = {
        income: 0,
        expense: 0,
      };
    }
    data.forEach((t) => {
      const transactionDate = t.date.toDate();
      let keyDate;
      switch (aggregationType) {
        case "yearly":
          keyDate = getStartOfYear(transactionDate);
          break;
        case "quarterly":
          keyDate = getStartOfQuarter(transactionDate);
          break;
        case "monthly":
          keyDate = getStartOfMonth(transactionDate);
          break;
        case "weekly":
          keyDate = getStartOfWeek(transactionDate);
          break;
        default:
          keyDate = transactionDate;
      }
      const keyString = keyDate.toISOString().split("T")[0];
      if (groupedData[keyString]) {
        if (t.type === "income") {
          groupedData[keyString].income += t.amount;
        } else {
          groupedData[keyString].expense += t.amount;
        }
      }
    });
    const sortedKeys = Object.keys(groupedData).sort();
    const labels = [];
    const tooltipTitles = [];
    sortedKeys.forEach((key) => {
      const date = createTimezoneSafeDate(key);
      switch (aggregationType) {
        case "yearly":
          labels.push(date.getUTCFullYear());
          const yearEnd = new Date(date.getTime());
          yearEnd.setUTCFullYear(yearEnd.getUTCFullYear() + 1);
          yearEnd.setUTCDate(0);
          tooltipTitles.push(
            `${date.toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
            })} - ${yearEnd.toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
            })}`
          );
          break;
        case "quarterly":
          const quarter = Math.floor(date.getUTCMonth() / 3) + 1;
          labels.push(`Q${quarter} ${date.getUTCFullYear()}`);
          const quarterEnd = new Date(date.getTime());
          quarterEnd.setUTCMonth(quarterEnd.getUTCMonth() + 3);
          quarterEnd.setUTCDate(0);
          tooltipTitles.push(
            `${date.toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
            })} - ${quarterEnd.toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
            })}`
          );
          break;
        case "monthly":
          labels.push(
            date.toLocaleDateString("en-US", {
              month: "short",
              year: "numeric",
            })
          );
          tooltipTitles.push(
            date.toLocaleDateString("en-US", { month: "long", year: "numeric" })
          );
          break;
        case "weekly":
          const weekEnd = new Date(date.getTime());
          weekEnd.setUTCDate(date.getUTCDate() + 6);
          labels.push(
            `Wk of ${date.toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
            })}`
          );
          tooltipTitles.push(
            `${date.toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
            })} - ${weekEnd.toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
            })}`
          );
          break;
        default:
          labels.push(
            date.toLocaleDateString("en-US", { month: "short", day: "numeric" })
          );
          tooltipTitles.push(
            date.toLocaleDateString("en-US", {
              weekday: "long",
              month: "long",
              day: "numeric",
            })
          );
      }
    });
    return {
      labels,
      tooltipTitles,
      incomeData: sortedKeys.map((key) => groupedData[key].income),
      expenseData: sortedKeys.map((key) => groupedData[key].expense),
    };
  };

  const renderChart = (chartData) => {
    if (transactionsChart) {
      transactionsChart.destroy();
    }
    transactionsChart = new Chart(chartCanvas, {
      type: "bar",
      data: {
        labels: chartData.labels,
        datasets: [
          {
            label: "Income",
            data: chartData.incomeData,
            backgroundColor: "rgba(32, 201, 151, 0.7)",
            borderColor: "rgba(32, 201, 151, 1)",
            borderWidth: 1,
          },
          {
            label: "Expenses",
            data: chartData.expenseData,
            backgroundColor: "rgba(250, 82, 82, 0.7)",
            borderColor: "rgba(250, 82, 82, 1)",
            borderWidth: 1,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          y: {
            beginAtZero: true,
            ticks: { callback: (value) => `$${formatCurrency(value)}` },
          },
          x: { grid: { display: false } },
        },
        plugins: {
          tooltip: {
            callbacks: {
              title: (tooltipItems) => {
                const index = tooltipItems[0].dataIndex;
                return chartData.tooltipTitles[index];
              },
              label: (context) =>
                `${context.dataset.label}: $${formatCurrency(context.raw)}`,
            },
          },
        },
      },
    });
  };

  const updateChart = async () => {
    const period = timePeriodFilter.value;
    let startDateStr, endDateStr;
    if (period === "custom") {
      startDateStr = startDateInput.value;
      endDateStr = endDateInput.value;
    } else {
      const days = parseInt(period);
      endDateStr = getTodayDateString();
      startDateStr = getDateStringDaysAgo(days - 1);
    }
    if (!startDateStr || !endDateStr || startDateStr > endDateStr) {
      aiSummaryContent.textContent = "Please select a valid date range.";
      aiSummaryContent.classList.remove("loading");
      return;
    }
    const rawData = await fetchChartData(startDateStr, endDateStr);
    const processedData = processChartData(rawData, startDateStr, endDateStr);
    renderChart(processedData);
    generateAISummary(rawData);
  };

  const openReportsModal = () => {
    reportsModal.classList.remove("hidden");
    if (!startDateInput.value) {
      startDateInput.value = getDateStringDaysAgo(29);
      endDateInput.value = getTodayDateString();
    }
    updateChart();
  };
  const closeReportsModal = () => reportsModal.classList.add("hidden");

  // --- EVENT LISTENERS SETUP ---
  typeDropdown.addEventListener("change", (e) => {
    categoryDropdown.classList.toggle("hidden", e.target.value !== "expense");
  });
  transactionForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const data = {
      description: e.target.elements.description.value,
      amount: parseFloat(e.target.elements.amount.value),
      date: Timestamp.fromDate(
        createTimezoneSafeDate(e.target.elements.date.value)
      ),
      type: e.target.elements.type.value,
    };
    if (data.type === "expense")
      data.category = e.target.elements.category.value;
    addTransaction(data);
    e.target.reset();
    e.target.elements.date.value = getTodayDateString();
    categoryDropdown.classList.add("hidden");
  });
  mainFilters.addEventListener("click", (e) => {
    if (e.target.classList.contains("filter-btn")) {
      mainFilters.querySelector(".active").classList.remove("active");
      e.target.classList.add("active");
      const type = e.target.dataset.type;
      currentFilter = { type };
      categoryFilters.classList.toggle("hidden", type !== "expense");
      if (type === "expense") {
        categoryFilterDropdown.value = "all";
        currentFilter.category = "all";
      }
      resetAndRefresh();
    }
  });
  categoryFilterDropdown.addEventListener("change", (e) => {
    currentFilter.category = e.target.value;
    resetAndRefresh();
  });
  transactionList.addEventListener("click", (e) => {
    const target = e.target.closest("button");
    if (!target) return;
    const transactionId = target.dataset.id;
    if (target.classList.contains("delete-btn")) {
      if (confirm("Are you sure?")) deleteTransaction(transactionId);
    } else if (target.classList.contains("edit-btn")) {
      const transaction = transactions.find((t) => t.id === transactionId);
      if (transaction) openEditModal(transaction);
    }
  });
  nextPageBtn.addEventListener("click", () => {
    if (currentPage < totalPages) {
      currentPage++;
      fetchTransactionsForPage(currentPage);
    }
  });
  prevPageBtn.addEventListener("click", () => {
    if (currentPage > 1) {
      currentPage--;
      fetchTransactionsForPage(currentPage);
    }
  });
  editTypeDropdown.addEventListener("change", (e) => {
    editCategoryGroup.classList.toggle("hidden", e.target.value !== "expense");
  });
  editForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const id = e.target.elements["edit-id"].value;
    const data = {
      description: e.target.elements["edit-description"].value,
      amount: parseFloat(e.target.elements["edit-amount"].value),
      date: Timestamp.fromDate(
        createTimezoneSafeDate(e.target.elements["edit-date"].value)
      ),
      type: e.target.elements["edit-type"].value,
    };
    data.category =
      data.type === "expense" ? e.target.elements["edit-category"].value : null;
    updateTransaction(id, data);
    closeEditModal();
  });
  closeModalBtn.addEventListener("click", closeEditModal);
  cancelEditBtn.addEventListener("click", closeEditModal);
  reportsBtn.addEventListener("click", openReportsModal);
  closeReportsModalBtn.addEventListener("click", closeReportsModal);
  timePeriodFilter.addEventListener("change", () => {
    const isCustom = timePeriodFilter.value === "custom";
    customDateRangeEl.classList.toggle("hidden", !isCustom);
    updateChart();
  });
  startDateInput.addEventListener("change", updateChart);
  endDateInput.addEventListener("change", updateChart);

  // --- INITIAL DATA LOAD ---
  transactionForm.elements.date.value = getTodayDateString();
  await updateGlobalSummary();
  await resetAndRefresh();
}

// --- UI RENDERING FUNCTIONS ---
function updatePaginationUI() {
  pageInfoEl.textContent = `Page ${currentPage} of ${totalPages}`;
  prevPageBtn.disabled = currentPage === 1;
  nextPageBtn.disabled = currentPage >= totalPages;
}
function renderTransactions() {
  transactionList.innerHTML = "";
  if (transactions.length === 0) {
    transactionList.innerHTML = `<p class="no-transactions">No transactions found for the selected filter.</p>`;
    return;
  }
  transactions.forEach((t) => {
    const item = document.createElement("li");
    const date = t.date.toDate();
    const formattedDate = date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
    const categoryDisplay = t.category
      ? `&bull; ${t.category.charAt(0).toUpperCase() + t.category.slice(1)}`
      : "";
    item.innerHTML = `
      <div class="transaction-item-main">
        <span class="description">${t.description}</span>
        <span class="transaction-date">${formattedDate} ${categoryDisplay}</span>
      </div>
      <div class="transaction-actions">
          <span class="amount ${t.type}-color">
            ${t.type === "income" ? "+" : "-"}$${formatCurrency(t.amount)}
          </span>
          <button class="edit-btn" data-id="${
            t.id
          }" title="Edit">&#9998;</button>
          <button class="delete-btn" data-id="${
            t.id
          }" title="Delete">&times;</button>
      </div>
    `;
    transactionList.appendChild(item);
  });
}
