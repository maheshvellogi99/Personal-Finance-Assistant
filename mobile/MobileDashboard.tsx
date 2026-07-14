import React from 'react';
import {
  StyleSheet,
  Text,
  View,
  SafeAreaView,
  FlatList,
  ScrollView,
  TouchableOpacity,
  Dimensions,
  Platform,
  StatusBar,
} from 'react-native';

// Get device screen width for responsive sizing
const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CARD_WIDTH = SCREEN_WIDTH * 0.72; // Horizontal budget cards layout sizing

// ── Types & Interfaces ──────────────────────────────────────────────────
export interface Transaction {
  id: string;
  description: string;
  category: string;
  amount: number;
  type: 'income' | 'expense';
  date: string;
  status: 'Completed' | 'Pending';
}

export interface BudgetItem {
  id: string;
  category: string;
  label: string;
  limit: number;
  spent: number;
  icon: string;
}

// ── Mock Data ───────────────────────────────────────────────────────────
const MOCK_NET_WORTH = {
  total: 12450.60,
  changePct: 4.8,
  monthlyIncome: 5200.00,
  monthlyExpenses: 1894.20,
  expenseChangePct: 12.4,
};

const MOCK_BUDGETS: BudgetItem[] = [
  {
    id: 'b-001',
    category: 'food',
    label: 'Food & Dining',
    limit: 600.0,
    spent: 480.0,
    icon: '🍔',
  },
  {
    id: 'b-002',
    category: 'entertainment',
    label: 'Entertainment',
    limit: 250.0,
    spent: 245.5,
    icon: '🍿',
  },
  {
    id: 'b-003',
    category: 'shopping',
    label: 'Shopping',
    limit: 400.0,
    spent: 380.0,
    icon: '🛍️',
  },
  {
    id: 'b-004',
    category: 'transportation',
    label: 'Transportation',
    limit: 200.0,
    spent: 120.0,
    icon: '🚗',
  },
  {
    id: 'b-005',
    category: 'utilities',
    label: 'Utilities & Tech',
    limit: 150.0,
    spent: 89.2,
    icon: '⚡',
  },
];

const MOCK_TRANSACTIONS: Transaction[] = [
  {
    id: 'tx-001',
    description: 'Whole Foods Market',
    category: 'Groceries',
    amount: 142.50,
    type: 'expense',
    date: '2026-06-19T14:32:00Z',
    status: 'Completed',
  },
  {
    id: 'tx-002',
    description: 'Salary Geonixa Corp',
    category: 'Salary',
    amount: 5200.00,
    type: 'income',
    date: '2026-06-15T09:00:00Z',
    status: 'Completed',
  },
  {
    id: 'tx-003',
    description: 'AWS Cloud Services Bill',
    category: 'Hosting & Tech',
    amount: 89.20,
    type: 'expense',
    date: '2026-06-12T00:15:00Z',
    status: 'Completed',
  },
  {
    id: 'tx-004',
    description: 'Starbucks Coffee',
    category: 'Dining Out',
    amount: 6.85,
    type: 'expense',
    date: '2026-06-18T08:44:00Z',
    status: 'Pending',
  },
  {
    id: 'tx-005',
    description: 'Uber Ride City Center',
    category: 'Transport',
    amount: 24.15,
    type: 'expense',
    date: '2026-06-17T18:21:00Z',
    status: 'Completed',
  },
];

// ── Utility Formatting Helpers ──────────────────────────────────────────
const formatCurrency = (val: number): string => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(val);
};

// Determine progress bar fill color according to thresholds
const getProgressBarColor = (percentage: number): string => {
  if (percentage >= 90) return '#EF4444'; // Red warning
  if (percentage >= 70) return '#F59E0B'; // Amber orange warning
  return '#10B981'; // Green on-track
};

// ── Shared Sub-Components ───────────────────────────────────────────────

// 1. NetWorthCard: Hero visual metrics card
interface NetWorthCardProps {
  onExport: () => void;
  onAddTransaction: () => void;
}

const NetWorthCard: React.FC<NetWorthCardProps> = ({ onExport, onAddTransaction }) => {
  return (
    <View style={styles.netWorthCard}>
      <View style={styles.netWorthHeader}>
        <Text style={styles.netWorthTitle}>TOTAL NET WORTH</Text>
        <View style={styles.kpiIconContainer}>
          <Text style={styles.kpiIcon}>⚖️</Text>
        </View>
      </View>

      <Text style={styles.netWorthAmount}>{formatCurrency(MOCK_NET_WORTH.total)}</Text>
      
      <View style={styles.growthRow}>
        <Text style={styles.growthIndicator}>▲ +{MOCK_NET_WORTH.changePct}%</Text>
        <Text style={styles.growthSubtext}>from last month</Text>
      </View>

      <View style={styles.divider} />

      {/* Mini KPIs Grid */}
      <View style={styles.kpiSubGrid}>
        <View style={styles.kpiCol}>
          <Text style={styles.kpiSubTitle}>MONTHLY INCOME</Text>
          <Text style={styles.kpiSubAmount}>{formatCurrency(MOCK_NET_WORTH.monthlyIncome)}</Text>
          <Text style={[styles.kpiStatusText, { color: '#10B981' }]}>On Track</Text>
        </View>
        <View style={styles.verticalDivider} />
        <View style={styles.kpiCol}>
          <Text style={styles.kpiSubTitle}>MONTHLY EXPENSES</Text>
          <Text style={styles.kpiSubAmount}>{formatCurrency(MOCK_NET_WORTH.monthlyExpenses)}</Text>
          <Text style={[styles.kpiStatusText, { color: '#EF4444' }]}>+{MOCK_NET_WORTH.expenseChangePct}% vs limit</Text>
        </View>
      </View>

      <View style={styles.cardActionRow}>
        <TouchableOpacity 
          style={styles.cardOutlineBtn} 
          activeOpacity={0.7}
          onPress={onExport}
        >
          <Text style={styles.cardOutlineBtnText}>Export Report</Text>
        </TouchableOpacity>

        <TouchableOpacity 
          style={styles.cardPrimaryBtn} 
          activeOpacity={0.7}
          onPress={onAddTransaction}
        >
          <Text style={styles.cardPrimaryBtnText}>＋ Add Transaction</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

// 2. BudgetCard: Horizontal Budget list item
interface BudgetCardProps {
  item: BudgetItem;
  onPress: (item: BudgetItem) => void;
}

const BudgetCard: React.FC<BudgetCardProps> = ({ item, onPress }) => {
  const percentage = (item.spent / item.limit) * 100;
  const remaining = item.limit - item.spent;
  const color = getProgressBarColor(percentage);
  
  // Custom status text label based on threshold
  let statusText = 'On Track';
  let badgeBg = 'rgba(16, 185, 129, 0.1)';
  let badgeTextColor = '#10B981';

  if (percentage >= 90) {
    statusText = 'Over Budget';
    badgeBg = 'rgba(239, 68, 68, 0.1)';
    badgeTextColor = '#EF4444';
  } else if (percentage >= 70) {
    statusText = 'At Risk';
    badgeBg = 'rgba(245, 158, 11, 0.1)';
    badgeTextColor = '#F59E0B';
  }

  return (
    <TouchableOpacity 
      style={styles.budgetCard} 
      activeOpacity={0.8}
      onPress={() => onPress(item)}
    >
      <View style={styles.budgetCardHeader}>
        <View style={styles.budgetCategoryRow}>
          <Text style={styles.categoryEmoji}>{item.icon}</Text>
          <Text style={styles.budgetCategoryLabel} numberOfLines={1}>
            {item.label}
          </Text>
        </View>
        <View style={[styles.statusBadge, { backgroundColor: badgeBg }]}>
          <Text style={[styles.statusBadgeText, { color: badgeTextColor }]}>
            {statusText}
          </Text>
        </View>
      </View>

      <View style={styles.budgetAmountRow}>
        <Text style={styles.budgetSpentText}>
          {formatCurrency(item.spent)}
          <Text style={styles.budgetLimitText}> / {formatCurrency(item.limit)}</Text>
        </Text>
        <Text style={[styles.budgetPercentageText, { color }]}>
          {percentage.toFixed(0)}%
        </Text>
      </View>

      {/* Wrapping progress bar View and inner dynamic styled View */}
      <View style={styles.progressBarTrack}>
        <View 
          style={[
            styles.progressBarFill, 
            { 
              width: `${Math.min(percentage, 100)}%`,
              backgroundColor: color,
            }
          ]} 
        />
      </View>

      <View style={styles.budgetCardFooter}>
        <Text style={styles.remainingText}>
          {remaining > 0 ? `${formatCurrency(remaining)} remaining` : 'Limit exhausted'}
        </Text>
        {percentage >= 90 && (
          <Text style={styles.alertIndicator}>⚠️ Alert</Text>
        )}
      </View>
    </TouchableOpacity>
  );
};

// 3. TransactionItem: FlatList vertical row item
interface TransactionItemProps {
  transaction: Transaction;
  onPress: (tx: Transaction) => void;
}

const TransactionItem: React.FC<TransactionItemProps> = ({ transaction, onPress }) => {
  const isIncome = transaction.type === 'income';
  
  return (
    <TouchableOpacity 
      style={styles.transactionRow} 
      activeOpacity={0.7}
      onPress={() => onPress(transaction)}
    >
      <View style={styles.txLeftCol}>
        <View style={styles.txIconContainer}>
          <Text style={styles.txEmojiIcon}>
            {isIncome ? '💰' : '💳'}
          </Text>
        </View>
        <View style={styles.txDetails}>
          <Text style={styles.txDescription} numberOfLines={1}>{transaction.description}</Text>
          <View style={styles.txBadgeRow}>
            <Text style={styles.txCategoryText}>{transaction.category}</Text>
            <View style={styles.statusDotRow}>
              <View 
                style={[
                  styles.statusDot, 
                  { backgroundColor: transaction.status === 'Completed' ? '#10B981' : '#F59E0B' }
                ]} 
              />
              <Text style={styles.statusLabel}>{transaction.status}</Text>
            </View>
          </View>
        </View>
      </View>

      <Text style={[styles.txAmountText, { color: isIncome ? '#10B981' : '#232F3E' }]}>
        {isIncome ? '+' : '-'}{formatCurrency(transaction.amount)}
      </Text>
    </TouchableOpacity>
  );
};

// ── Main MobileDashboard Component ──────────────────────────────────────
export default function MobileDashboard() {
  
  // Click Action Handlers for Native Interactive Feedback
  const handleExport = () => {
    console.log('Exporting Financial Report...');
    alert('Exporting PDF/CSV Report. Ready in background.');
  };

  const handleAddTransaction = () => {
    console.log('Navigating to Add Transaction Screen...');
    alert('Redirecting to the manual transaction entry form.');
  };

  const handleBudgetPress = (budget: BudgetItem) => {
    console.log(`Selected budget category: ${budget.label}`);
    alert(`Category: ${budget.label}\nLimit: ${formatCurrency(budget.limit)}\nSpent: ${formatCurrency(budget.spent)}`);
  };

  const handleTransactionPress = (tx: Transaction) => {
    console.log(`Selected transaction: ${tx.description}`);
    alert(`Transaction Details:\n${tx.description}\nAmount: ${formatCurrency(tx.amount)}\nStatus: ${tx.status}`);
  };

  const handleAskAI = () => {
    console.log('Opening AI Personal Finance Chat Assistant...');
    alert('Connecting to AWS SageMaker/Claude AI assistant...');
  };

  // Render method for Header Section elements inside the single parent FlatList
  const renderDashboardHeader = () => {
    return (
      <View style={styles.headerContainer}>
        {/* Profile and Header Title */}
        <View style={styles.profileRow}>
          <View>
            <Text style={styles.greetingsText}>Welcome back,</Text>
            <Text style={styles.userNameText}>Mahesh Vellogi 👋</Text>
          </View>
          <View style={styles.avatarCircle}>
            <Text style={styles.avatarText}>MV</Text>
          </View>
        </View>

        {/* 3. Header Section Net Worth Metrics */}
        <NetWorthCard 
          onExport={handleExport}
          onAddTransaction={handleAddTransaction}
        />

        {/* 4. Middle Section Horizontally Scrolling Budgets */}
        <View style={styles.budgetHeaderRow}>
          <Text style={styles.sectionHeaderTitle}>Active Budgets</Text>
          <Text style={styles.sectionHeaderSubtitle}>Slide to inspect limits</Text>
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          decelerationRate="fast"
          snapToInterval={CARD_WIDTH + 16} // Snaps nicely on scroll
          contentContainerStyle={styles.budgetHorizontalScroll}
        >
          {MOCK_BUDGETS.map((item) => (
            <BudgetCard 
              key={item.id} 
              item={item} 
              onPress={handleBudgetPress}
            />
          ))}
        </ScrollView>

        {/* Recent Transactions List Title */}
        <View style={styles.recentTxTitleRow}>
          <Text style={styles.sectionHeaderTitle}>Recent Transactions</Text>
          <TouchableOpacity activeOpacity={0.6}>
            <Text style={styles.viewAllLink}>View All</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" backgroundColor="#F2F3F3" />
      
      {/* 5. Bottom Section Vertically Scrolling list using performant FlatList */}
      <FlatList
        data={MOCK_TRANSACTIONS}
        renderItem={({ item }) => (
          <TransactionItem 
            transaction={item} 
            onPress={handleTransactionPress}
          />
        )}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={renderDashboardHeader}
        contentContainerStyle={styles.mainScrollContent}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>No recent transactions found.</Text>
          </View>
        }
      />

      {/* 6. Sticky Floating Action Button (FAB) for AI Chat Assistant */}
      <TouchableOpacity 
        style={styles.floatingActionButton} 
        activeOpacity={0.85}
        onPress={handleAskAI}
      >
        <Text style={styles.fabIcon}>🤖</Text>
        <Text style={styles.fabText}>Ask Assistant</Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
}

// ── StyleSheet Mappings (Strict AWS Design System Constants) ───────────
const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#F2F3F3', // Light Grey Background
  },
  mainScrollContent: {
    paddingBottom: 100, // Allocate space below for the floating action button (FAB)
  },
  headerContainer: {
    width: '100%',
  },
  profileRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: Platform.OS === 'android' ? 24 : 16,
    paddingBottom: 20,
  },
  greetingsText: {
    fontSize: 14,
    color: '#6b7280',
    fontStyle: 'normal',
  },
  userNameText: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#232F3E', // Deep Charcoal
    marginTop: 2,
  },
  avatarCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#FF9900', // AWS Orange
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#FFFFFF',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.15,
        shadowRadius: 3,
      },
      android: {
        elevation: 3,
      },
    }),
  },
  avatarText: {
    color: '#232F3E',
    fontWeight: 'bold',
    fontSize: 14,
  },
  // NetWorthCard styling
  netWorthCard: {
    backgroundColor: '#FFFFFF', // Pure White Container
    borderRadius: 12,
    marginHorizontal: 20,
    padding: 20,
    marginBottom: 24,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.08,
        shadowRadius: 8,
      },
      android: {
        elevation: 4,
      },
    }),
  },
  netWorthHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  netWorthTitle: {
    fontSize: 11,
    fontWeight: '800',
    color: '#879596', // Slate gray subtitle
    letterSpacing: 1.2,
  },
  kpiIconContainer: {
    backgroundColor: 'rgba(255, 153, 0, 0.1)', // Subtle AWS Orange opacity
    padding: 6,
    borderRadius: 6,
  },
  kpiIcon: {
    fontSize: 16,
  },
  netWorthAmount: {
    fontSize: 32,
    fontWeight: '900',
    color: '#232F3E', // Deep Charcoal
    marginTop: 8,
    letterSpacing: -0.5,
  },
  growthRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
  },
  growthIndicator: {
    color: '#10B981', // Emerald green growth indicator
    fontSize: 13,
    fontWeight: 'bold',
  },
  growthSubtext: {
    color: '#879596',
    fontSize: 12,
    marginLeft: 6,
  },
  divider: {
    height: 1,
    backgroundColor: '#E5E7EB',
    marginVertical: 16,
  },
  kpiSubGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  kpiCol: {
    flex: 1,
  },
  kpiSubTitle: {
    fontSize: 9,
    fontWeight: '700',
    color: '#879596',
    letterSpacing: 0.8,
  },
  kpiSubAmount: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#232F3E',
    marginTop: 4,
  },
  kpiStatusText: {
    fontSize: 10,
    fontWeight: '700',
    marginTop: 2,
  },
  verticalDivider: {
    width: 1,
    height: 48,
    backgroundColor: '#E5E7EB',
    marginHorizontal: 16,
  },
  cardActionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  cardOutlineBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#232F3E',
    borderRadius: 6,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardOutlineBtnText: {
    color: '#232F3E',
    fontSize: 13,
    fontWeight: 'bold',
  },
  cardPrimaryBtn: {
    flex: 1.2,
    backgroundColor: '#FF9900', // AWS Orange
    borderRadius: 6,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardPrimaryBtnText: {
    color: '#232F3E',
    fontSize: 13,
    fontWeight: 'bold',
  },
  // Budget ScrollView styling
  budgetHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    paddingHorizontal: 20,
    marginBottom: 12,
  },
  sectionHeaderTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#232F3E', // Deep Charcoal
  },
  sectionHeaderSubtitle: {
    fontSize: 11,
    color: '#879596',
  },
  budgetHorizontalScroll: {
    paddingLeft: 20,
    paddingRight: 4, // Leave spacing on right end of scrollview content
    paddingBottom: 24,
  },
  budgetCard: {
    backgroundColor: '#FFFFFF',
    width: CARD_WIDTH,
    borderRadius: 10,
    padding: 16,
    marginRight: 16,
    borderWidth: 1,
    borderColor: 'rgba(0, 0, 0, 0.04)',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.06,
        shadowRadius: 5,
      },
      android: {
        elevation: 2,
      },
    }),
  },
  budgetCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  budgetCategoryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    paddingRight: 6,
  },
  categoryEmoji: {
    fontSize: 16,
    marginRight: 6,
  },
  budgetCategoryLabel: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#232F3E',
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  statusBadgeText: {
    fontSize: 9,
    fontWeight: 'bold',
    textTransform: 'uppercase',
  },
  budgetAmountRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginTop: 14,
    marginBottom: 6,
  },
  budgetSpentText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#232F3E',
  },
  budgetLimitText: {
    fontSize: 12,
    fontWeight: '300',
    color: '#9CA3AF',
  },
  budgetPercentageText: {
    fontSize: 13,
    fontWeight: 'bold',
  },
  // Wrapping progress bar track View container
  progressBarTrack: {
    height: 8,
    backgroundColor: '#E5E7EB',
    borderRadius: 4,
    width: '100%',
    overflow: 'hidden',
    marginBottom: 8,
  },
  // Inner dynamic styled progress bar View
  progressBarFill: {
    height: '100%',
    borderRadius: 4,
  },
  budgetCardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 2,
  },
  remainingText: {
    fontSize: 10,
    color: '#9CA3AF',
  },
  alertIndicator: {
    color: '#EF4444',
    fontSize: 10,
    fontWeight: 'bold',
  },
  // Transactions vertical list section
  recentTxTitleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    marginTop: 8,
    marginBottom: 14,
  },
  viewAllLink: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#FF9900', // AWS Orange link
  },
  transactionRow: {
    backgroundColor: '#FFFFFF',
    marginHorizontal: 20,
    marginBottom: 10,
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 14,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.02)',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.04,
        shadowRadius: 3,
      },
      android: {
        elevation: 1,
      },
    }),
  },
  txLeftCol: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    paddingRight: 10,
  },
  txIconContainer: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  txEmojiIcon: {
    fontSize: 16,
  },
  txDetails: {
    flex: 1,
  },
  txDescription: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#232F3E',
  },
  txBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
  txCategoryText: {
    fontSize: 11,
    color: '#6B7280',
    backgroundColor: '#F3F4F6',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    marginRight: 10,
    fontWeight: '500',
  },
  statusDotRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 4,
  },
  statusLabel: {
    fontSize: 11,
    color: '#9CA3AF',
  },
  txAmountText: {
    fontSize: 15,
    fontWeight: 'bold',
    textAlign: 'right',
  },
  emptyContainer: {
    padding: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    color: '#9CA3AF',
    fontSize: 14,
  },
  // Sticky Bottom FAB for "Ask AI Assistant"
  floatingActionButton: {
    position: 'absolute',
    bottom: 24,
    right: 20,
    backgroundColor: '#FF9900', // AWS Orange accent
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 30,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.25,
        shadowRadius: 6,
      },
      android: {
        elevation: 6,
      },
    }),
  },
  fabIcon: {
    fontSize: 18,
    marginRight: 8,
  },
  fabText: {
    color: '#232F3E', // Deep Charcoal
    fontWeight: 'bold',
    fontSize: 14,
  },
});
