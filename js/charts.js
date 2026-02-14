/**
 * Simple SVG Chart Utilities
 * Lightweight charting without external dependencies
 */
const Charts = {
  colors: ['#2563eb', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'],

  /**
   * Create a line/area chart for contribution history
   * @param {HTMLElement} container - Container element
   * @param {Object} options - Chart options
   */
  contributionChart(container, options) {
    const {
      data, // Array of { month, members: [{ name, spent, contributed }] }
      height = 200,
      showLegend = true
    } = options;

    if (!data || data.length === 0) {
      container.innerHTML = '<p class="text-muted">No data available</p>';
      return;
    }

    const width = container.clientWidth || 600;
    const padding = { top: 20, right: 20, bottom: 40, left: 60 };
    const chartWidth = width - padding.left - padding.right;
    const chartHeight = height - padding.top - padding.bottom;

    // Get member names from first data point
    const memberNames = data[0].members.map(m => m.name);

    // Calculate max value for scale
    let maxValue = 0;
    data.forEach(d => {
      d.members.forEach(m => {
        maxValue = Math.max(maxValue, m.spent, m.contributed);
      });
    });
    maxValue = Math.ceil(maxValue / 1000) * 1000; // Round up to nearest 1000

    // Create SVG
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', height);
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.setAttribute('class', 'contribution-chart');

    // Background grid
    const gridGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    gridGroup.setAttribute('class', 'chart-grid');

    const gridLines = 5;
    for (let i = 0; i <= gridLines; i++) {
      const y = padding.top + (chartHeight / gridLines) * i;
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', padding.left);
      line.setAttribute('x2', width - padding.right);
      line.setAttribute('y1', y);
      line.setAttribute('y2', y);
      line.setAttribute('stroke', '#e5e7eb');
      line.setAttribute('stroke-dasharray', '2,2');
      gridGroup.appendChild(line);

      // Y-axis labels
      const value = maxValue - (maxValue / gridLines) * i;
      const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      label.setAttribute('x', padding.left - 8);
      label.setAttribute('y', y + 4);
      label.setAttribute('text-anchor', 'end');
      label.setAttribute('class', 'chart-label');
      label.textContent = this.formatShortCurrency(value);
      gridGroup.appendChild(label);
    }
    svg.appendChild(gridGroup);

    // X scale
    const xStep = chartWidth / (data.length - 1 || 1);

    // Draw lines for each member's contributions
    memberNames.forEach((memberName, memberIdx) => {
      const color = this.colors[memberIdx % this.colors.length];

      // Contribution line (area)
      const areaPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      let areaD = `M ${padding.left} ${padding.top + chartHeight}`;

      const linePath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      let lineD = '';

      data.forEach((d, i) => {
        const memberData = d.members.find(m => m.name === memberName) || { contributed: 0 };
        const x = padding.left + i * xStep;
        const y = padding.top + chartHeight - (memberData.contributed / maxValue) * chartHeight;

        if (i === 0) {
          lineD = `M ${x} ${y}`;
          areaD += ` L ${x} ${y}`;
        } else {
          lineD += ` L ${x} ${y}`;
          areaD += ` L ${x} ${y}`;
        }
      });

      // Close area path
      areaD += ` L ${padding.left + (data.length - 1) * xStep} ${padding.top + chartHeight} Z`;

      areaPath.setAttribute('d', areaD);
      areaPath.setAttribute('fill', color);
      areaPath.setAttribute('fill-opacity', '0.1');
      svg.appendChild(areaPath);

      linePath.setAttribute('d', lineD);
      linePath.setAttribute('stroke', color);
      linePath.setAttribute('stroke-width', '2');
      linePath.setAttribute('fill', 'none');
      svg.appendChild(linePath);

      // Data points
      data.forEach((d, i) => {
        const memberData = d.members.find(m => m.name === memberName) || { contributed: 0 };
        const x = padding.left + i * xStep;
        const y = padding.top + chartHeight - (memberData.contributed / maxValue) * chartHeight;

        const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        circle.setAttribute('cx', x);
        circle.setAttribute('cy', y);
        circle.setAttribute('r', '4');
        circle.setAttribute('fill', color);
        circle.setAttribute('class', 'chart-point');

        // Tooltip on hover
        const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
        title.textContent = `${memberName} - ${d.monthLabel}: ${this.formatShortCurrency(memberData.contributed)}`;
        circle.appendChild(title);

        svg.appendChild(circle);
      });
    });

    // X-axis labels
    data.forEach((d, i) => {
      if (data.length <= 12 || i % Math.ceil(data.length / 12) === 0) {
        const x = padding.left + i * xStep;
        const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        label.setAttribute('x', x);
        label.setAttribute('y', height - 10);
        label.setAttribute('text-anchor', 'middle');
        label.setAttribute('class', 'chart-label');
        label.textContent = d.monthLabel;
        svg.appendChild(label);
      }
    });

    // Clear container and add SVG
    container.innerHTML = '';
    container.appendChild(svg);

    // Add legend
    if (showLegend) {
      const legend = document.createElement('div');
      legend.className = 'chart-legend';
      legend.innerHTML = memberNames.map((name, i) => `
        <div class="chart-legend-item">
          <span class="chart-legend-color" style="background: ${this.colors[i % this.colors.length]}"></span>
          ${Utils.escapeHtml(name)}
        </div>
      `).join('');
      container.appendChild(legend);
    }
  },

  /**
   * Create a bar chart for monthly overview
   * @param {HTMLElement} container - Container element
   * @param {Object} options - Chart options
   */
  barChart(container, options) {
    const {
      data, // Array of { label, values: [{ name, value, color }] }
      height = 200,
      stacked = false
    } = options;

    if (!data || data.length === 0) {
      container.innerHTML = '<p class="text-muted">No data available</p>';
      return;
    }

    const width = container.clientWidth || 600;
    const padding = { top: 20, right: 20, bottom: 50, left: 60 };
    const chartWidth = width - padding.left - padding.right;
    const chartHeight = height - padding.top - padding.bottom;

    // Calculate max value
    let maxValue = 0;
    data.forEach(d => {
      if (stacked) {
        const sum = d.values.reduce((s, v) => s + Math.abs(v.value), 0);
        maxValue = Math.max(maxValue, sum);
      } else {
        d.values.forEach(v => {
          maxValue = Math.max(maxValue, Math.abs(v.value));
        });
      }
    });
    maxValue = Math.ceil(maxValue / 1000) * 1000;

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', height);
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.setAttribute('class', 'bar-chart');

    // Grid lines
    const gridLines = 5;
    for (let i = 0; i <= gridLines; i++) {
      const y = padding.top + (chartHeight / gridLines) * i;
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', padding.left);
      line.setAttribute('x2', width - padding.right);
      line.setAttribute('y1', y);
      line.setAttribute('y2', y);
      line.setAttribute('stroke', '#e5e7eb');
      line.setAttribute('stroke-dasharray', '2,2');
      svg.appendChild(line);

      const value = maxValue - (maxValue / gridLines) * i;
      const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      label.setAttribute('x', padding.left - 8);
      label.setAttribute('y', y + 4);
      label.setAttribute('text-anchor', 'end');
      label.setAttribute('class', 'chart-label');
      label.textContent = this.formatShortCurrency(value);
      svg.appendChild(label);
    }

    // Draw bars
    const groupWidth = chartWidth / data.length;
    const barPadding = groupWidth * 0.2;
    const numBars = stacked ? 1 : data[0].values.length;
    const barWidth = (groupWidth - barPadding * 2) / numBars;

    data.forEach((d, groupIdx) => {
      const groupX = padding.left + groupIdx * groupWidth;

      if (stacked) {
        let currentY = padding.top + chartHeight;
        d.values.forEach((v, barIdx) => {
          const barHeight = (Math.abs(v.value) / maxValue) * chartHeight;
          currentY -= barHeight;

          const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
          rect.setAttribute('x', groupX + barPadding);
          rect.setAttribute('y', currentY);
          rect.setAttribute('width', barWidth);
          rect.setAttribute('height', barHeight);
          rect.setAttribute('fill', v.color || this.colors[barIdx % this.colors.length]);
          rect.setAttribute('class', 'chart-bar');

          const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
          title.textContent = `${v.name}: ${this.formatShortCurrency(v.value)}`;
          rect.appendChild(title);

          svg.appendChild(rect);
        });
      } else {
        d.values.forEach((v, barIdx) => {
          const barHeight = (Math.abs(v.value) / maxValue) * chartHeight;
          const barX = groupX + barPadding + barIdx * barWidth;
          const barY = padding.top + chartHeight - barHeight;

          const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
          rect.setAttribute('x', barX);
          rect.setAttribute('y', barY);
          rect.setAttribute('width', barWidth - 2);
          rect.setAttribute('height', barHeight);
          rect.setAttribute('fill', v.color || this.colors[barIdx % this.colors.length]);
          rect.setAttribute('class', 'chart-bar');

          const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
          title.textContent = `${v.name}: ${this.formatShortCurrency(v.value)}`;
          rect.appendChild(title);

          svg.appendChild(rect);
        });
      }

      // X-axis label
      const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      label.setAttribute('x', groupX + groupWidth / 2);
      label.setAttribute('y', height - 10);
      label.setAttribute('text-anchor', 'middle');
      label.setAttribute('class', 'chart-label');
      label.textContent = d.label;
      svg.appendChild(label);
    });

    container.innerHTML = '';
    container.appendChild(svg);
  },

  formatShortCurrency(value) {
    const absValue = Math.abs(value) / 1000; // Convert from milliunits
    if (absValue >= 1000) {
      return `€${(absValue / 1000).toFixed(1)}k`;
    }
    return `€${absValue.toFixed(0)}`;
  },

  /**
   * Create a cumulative expenses chart showing household expenses and per-member contributions
   * @param {HTMLElement} container - Container element
   * @param {Object} options - Chart options
   */
  cumulativeExpensesChart(container, options) {
    const {
      data, // Array of { month, monthLabel, expenses, [memberName]: value, ... }
      members, // Array of member names
      height = 280,
      showLegend = true
    } = options;

    if (!data || data.length === 0) {
      container.innerHTML = '<p class="text-muted">No data available</p>';
      return;
    }

    const width = container.clientWidth || 600;
    const padding = { top: 20, right: 20, bottom: 40, left: 70 };
    const chartWidth = width - padding.left - padding.right;
    const chartHeight = height - padding.top - padding.bottom;

    // Calculate min/max for scale
    let minValue = 0;
    let maxValue = 0;
    data.forEach(d => {
      maxValue = Math.max(maxValue, d.expenses);
      members.forEach(m => {
        maxValue = Math.max(maxValue, d[m] || 0);
      });
    });

    // Add padding to range
    maxValue = Math.ceil(maxValue * 1.1 / 1000) * 1000;
    if (maxValue === 0) maxValue = 1000;

    // Create SVG
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', height);
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.setAttribute('class', 'cumulative-chart');

    // Scale functions
    const xScale = (i) => padding.left + (i / (data.length - 1 || 1)) * chartWidth;
    const yScale = (v) => padding.top + chartHeight - ((v - minValue) / (maxValue - minValue || 1)) * chartHeight;

    // Draw grid lines and Y-axis labels
    const gridGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    gridGroup.setAttribute('class', 'chart-grid');

    const gridLines = 5;
    for (let i = 0; i <= gridLines; i++) {
      const y = padding.top + (chartHeight / gridLines) * i;
      const value = maxValue - ((maxValue - minValue) / gridLines) * i;

      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', padding.left);
      line.setAttribute('x2', width - padding.right);
      line.setAttribute('y1', y);
      line.setAttribute('y2', y);
      line.setAttribute('stroke', '#e5e7eb');
      line.setAttribute('stroke-dasharray', '2,2');
      gridGroup.appendChild(line);

      const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      label.setAttribute('x', padding.left - 8);
      label.setAttribute('y', y + 4);
      label.setAttribute('text-anchor', 'end');
      label.setAttribute('class', 'chart-label');
      label.textContent = this.formatShortCurrency(value);
      gridGroup.appendChild(label);
    }

    svg.appendChild(gridGroup);

    // Colors for lines
    const expensesColor = '#ef4444'; // Red for expenses
    const memberColors = ['#2563eb', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899']; // Blue, Green, Amber, Purple, Pink

    // Draw expenses area fill
    const areaPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    let areaD = `M ${xScale(0)} ${yScale(0)}`;
    data.forEach((d, i) => {
      areaD += ` L ${xScale(i)} ${yScale(d.expenses)}`;
    });
    areaD += ` L ${xScale(data.length - 1)} ${yScale(0)} Z`;
    areaPath.setAttribute('d', areaD);
    areaPath.setAttribute('fill', expensesColor);
    areaPath.setAttribute('fill-opacity', '0.1');
    svg.appendChild(areaPath);

    // Draw expenses line
    const expensesPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    let expensesD = '';
    data.forEach((d, i) => {
      const x = xScale(i);
      const y = yScale(d.expenses);
      expensesD += i === 0 ? `M ${x} ${y}` : ` L ${x} ${y}`;
    });
    expensesPath.setAttribute('d', expensesD);
    expensesPath.setAttribute('stroke', expensesColor);
    expensesPath.setAttribute('stroke-width', '3');
    expensesPath.setAttribute('fill', 'none');
    svg.appendChild(expensesPath);

    // Draw expenses points
    data.forEach((d, i) => {
      const x = xScale(i);
      const y = yScale(d.expenses);

      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('cx', x);
      circle.setAttribute('cy', y);
      circle.setAttribute('r', '4');
      circle.setAttribute('fill', expensesColor);
      circle.setAttribute('class', 'chart-point');

      const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
      title.textContent = `${d.monthLabel} - Expenses: ${this.formatShortCurrency(d.expenses)}`;
      circle.appendChild(title);

      svg.appendChild(circle);
    });

    // Draw member contribution lines
    members.forEach((memberName, memberIdx) => {
      const color = memberColors[memberIdx % memberColors.length];

      // Draw line
      const linePath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      let lineD = '';
      data.forEach((d, i) => {
        const x = xScale(i);
        const y = yScale(d[memberName] || 0);
        lineD += i === 0 ? `M ${x} ${y}` : ` L ${x} ${y}`;
      });
      linePath.setAttribute('d', lineD);
      linePath.setAttribute('stroke', color);
      linePath.setAttribute('stroke-width', '2');
      linePath.setAttribute('stroke-dasharray', '6,3');
      linePath.setAttribute('fill', 'none');
      svg.appendChild(linePath);

      // Draw points
      data.forEach((d, i) => {
        const x = xScale(i);
        const y = yScale(d[memberName] || 0);

        const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        circle.setAttribute('cx', x);
        circle.setAttribute('cy', y);
        circle.setAttribute('r', '3');
        circle.setAttribute('fill', color);
        circle.setAttribute('class', 'chart-point');

        const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
        title.textContent = `${d.monthLabel} - ${memberName}: ${this.formatShortCurrency(d[memberName] || 0)}`;
        circle.appendChild(title);

        svg.appendChild(circle);
      });
    });

    // X-axis labels
    const maxLabels = 12;
    const labelStep = Math.ceil(data.length / maxLabels);
    data.forEach((d, i) => {
      if (i % labelStep === 0 || i === data.length - 1) {
        const x = xScale(i);
        const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        label.setAttribute('x', x);
        label.setAttribute('y', height - 10);
        label.setAttribute('text-anchor', 'middle');
        label.setAttribute('class', 'chart-label');
        label.textContent = d.monthLabel;
        svg.appendChild(label);
      }
    });

    // Clear and add SVG
    container.innerHTML = '';
    container.appendChild(svg);

    // Add legend
    if (showLegend) {
      const memberLegendItems = members.map((name, idx) => `
        <div class="chart-legend-item">
          <span class="chart-legend-color" style="background: ${memberColors[idx % memberColors.length]}"></span>
          ${name}'s Contributions
        </div>
      `).join('');

      const legend = document.createElement('div');
      legend.className = 'chart-legend';
      legend.innerHTML = `
        <div class="chart-legend-item">
          <span class="chart-legend-color" style="background: ${expensesColor}"></span>
          Household Expenses
        </div>
        ${memberLegendItems}
      `;
      container.appendChild(legend);
    }
  },

  /**
   * Create a Sankey diagram for money flow visualization
   * Shows flow from member contributions (sources) to categories (sinks)
   * @param {HTMLElement} container - Container element
   * @param {Object} options - Chart options
   */
  sankeyChart(container, options) {
    const {
      data, // { sources: [{ name, amount, color }], targets: [{ name, amount, flows: [{ source, amount }] }] }
      height = 400,
      showLabels = true
    } = options;

    if (!data || !data.sources || data.sources.length === 0) {
      container.innerHTML = '<p class="text-muted">No data available</p>';
      return;
    }

    const width = container.clientWidth || 800;
    const padding = { top: 20, right: 150, bottom: 20, left: 150 };
    const chartWidth = width - padding.left - padding.right;
    const chartHeight = height - padding.top - padding.bottom;

    // Node dimensions
    const nodeWidth = 20;
    const nodePadding = 8;

    // Calculate total flow
    const totalFlow = data.sources.reduce((sum, s) => sum + s.amount, 0);

    // Calculate source node positions
    const sourceNodes = [];
    let sourceY = padding.top;
    const availableSourceHeight = chartHeight - (data.sources.length - 1) * nodePadding;

    data.sources.forEach((source, i) => {
      const nodeHeight = (source.amount / totalFlow) * availableSourceHeight;
      sourceNodes.push({
        ...source,
        x: padding.left,
        y: sourceY,
        height: Math.max(nodeHeight, 2),
        index: i
      });
      sourceY += nodeHeight + nodePadding;
    });

    // Calculate target node positions
    const targetNodes = [];
    let targetY = padding.top;
    const totalTargetFlow = data.targets.reduce((sum, t) => sum + t.amount, 0);
    const availableTargetHeight = chartHeight - (data.targets.length - 1) * nodePadding;

    data.targets.forEach((target, i) => {
      const nodeHeight = (target.amount / totalTargetFlow) * availableTargetHeight;
      targetNodes.push({
        ...target,
        x: width - padding.right - nodeWidth,
        y: targetY,
        height: Math.max(nodeHeight, 2),
        index: i
      });
      targetY += nodeHeight + nodePadding;
    });

    // Create SVG
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', height);
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.setAttribute('class', 'sankey-chart');

    // Create defs for gradients
    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    svg.appendChild(defs);

    // Track flow positions for stacking
    const sourceFlowOffsets = sourceNodes.map(() => 0);
    const targetFlowOffsets = targetNodes.map(() => 0);

    // Draw flows (links)
    const linksGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    linksGroup.setAttribute('class', 'sankey-links');

    targetNodes.forEach((target, targetIdx) => {
      if (!target.flows) return;

      target.flows.forEach(flow => {
        const sourceIdx = sourceNodes.findIndex(s => s.name === flow.source);
        if (sourceIdx === -1) return;

        const source = sourceNodes[sourceIdx];
        const flowHeight = (flow.amount / totalFlow) * availableSourceHeight;

        // Calculate flow positions
        const sourceStartY = source.y + sourceFlowOffsets[sourceIdx];
        const targetStartY = target.y + targetFlowOffsets[targetIdx];

        // Update offsets for next flow
        sourceFlowOffsets[sourceIdx] += flowHeight;
        targetFlowOffsets[targetIdx] += (flow.amount / target.amount) * target.height;

        // Create gradient for flow
        const gradientId = `flow-gradient-${sourceIdx}-${targetIdx}-${Math.random().toString(36).substr(2, 9)}`;
        const gradient = document.createElementNS('http://www.w3.org/2000/svg', 'linearGradient');
        gradient.setAttribute('id', gradientId);
        gradient.setAttribute('x1', '0%');
        gradient.setAttribute('y1', '0%');
        gradient.setAttribute('x2', '100%');
        gradient.setAttribute('y2', '0%');

        const stop1 = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
        stop1.setAttribute('offset', '0%');
        stop1.setAttribute('stop-color', source.color || this.colors[sourceIdx % this.colors.length]);
        stop1.setAttribute('stop-opacity', '0.6');

        const stop2 = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
        stop2.setAttribute('offset', '100%');
        stop2.setAttribute('stop-color', source.color || this.colors[sourceIdx % this.colors.length]);
        stop2.setAttribute('stop-opacity', '0.3');

        gradient.appendChild(stop1);
        gradient.appendChild(stop2);
        defs.appendChild(gradient);

        // Draw curved path
        const x0 = source.x + nodeWidth;
        const x1 = target.x;
        const xi = (x0 + x1) / 2;
        const y0Top = sourceStartY;
        const y0Bottom = sourceStartY + flowHeight;
        const y1Top = targetStartY;
        const y1Bottom = targetStartY + (flow.amount / target.amount) * target.height;

        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        const d = `
          M ${x0} ${y0Top}
          C ${xi} ${y0Top}, ${xi} ${y1Top}, ${x1} ${y1Top}
          L ${x1} ${y1Bottom}
          C ${xi} ${y1Bottom}, ${xi} ${y0Bottom}, ${x0} ${y0Bottom}
          Z
        `;
        path.setAttribute('d', d);
        path.setAttribute('fill', `url(#${gradientId})`);
        path.setAttribute('class', 'sankey-link');

        // Tooltip
        const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
        title.textContent = `${source.name} → ${target.name}: ${this.formatShortCurrency(flow.amount)}`;
        path.appendChild(title);

        linksGroup.appendChild(path);
      });
    });
    svg.appendChild(linksGroup);

    // Draw source nodes
    const nodesGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    nodesGroup.setAttribute('class', 'sankey-nodes');

    sourceNodes.forEach((node, i) => {
      const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      rect.setAttribute('x', node.x);
      rect.setAttribute('y', node.y);
      rect.setAttribute('width', nodeWidth);
      rect.setAttribute('height', node.height);
      rect.setAttribute('fill', node.color || this.colors[i % this.colors.length]);
      rect.setAttribute('class', 'sankey-node sankey-node-source');

      const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
      title.textContent = `${node.name}: ${this.formatShortCurrency(node.amount)}`;
      rect.appendChild(title);

      nodesGroup.appendChild(rect);

      // Label
      if (showLabels) {
        const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        label.setAttribute('x', node.x - 8);
        label.setAttribute('y', node.y + node.height / 2);
        label.setAttribute('text-anchor', 'end');
        label.setAttribute('dominant-baseline', 'middle');
        label.setAttribute('class', 'sankey-label sankey-label-source');
        label.textContent = node.name;
        nodesGroup.appendChild(label);

        const valueLabel = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        valueLabel.setAttribute('x', node.x - 8);
        valueLabel.setAttribute('y', node.y + node.height / 2 + 14);
        valueLabel.setAttribute('text-anchor', 'end');
        valueLabel.setAttribute('dominant-baseline', 'middle');
        valueLabel.setAttribute('class', 'sankey-label sankey-label-value');
        valueLabel.textContent = this.formatShortCurrency(node.amount);
        nodesGroup.appendChild(valueLabel);
      }
    });

    // Draw target nodes
    targetNodes.forEach((node, i) => {
      const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      rect.setAttribute('x', node.x);
      rect.setAttribute('y', node.y);
      rect.setAttribute('width', nodeWidth);
      rect.setAttribute('height', node.height);
      rect.setAttribute('fill', '#64748b');
      rect.setAttribute('class', 'sankey-node sankey-node-target');

      const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
      title.textContent = `${node.name}: ${this.formatShortCurrency(node.amount)}`;
      rect.appendChild(title);

      nodesGroup.appendChild(rect);

      // Label
      if (showLabels) {
        const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        label.setAttribute('x', node.x + nodeWidth + 8);
        label.setAttribute('y', node.y + node.height / 2);
        label.setAttribute('text-anchor', 'start');
        label.setAttribute('dominant-baseline', 'middle');
        label.setAttribute('class', 'sankey-label sankey-label-target');
        label.textContent = node.name.length > 20 ? node.name.substring(0, 18) + '...' : node.name;
        nodesGroup.appendChild(label);

        const valueLabel = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        valueLabel.setAttribute('x', node.x + nodeWidth + 8);
        valueLabel.setAttribute('y', node.y + node.height / 2 + 14);
        valueLabel.setAttribute('text-anchor', 'start');
        valueLabel.setAttribute('dominant-baseline', 'middle');
        valueLabel.setAttribute('class', 'sankey-label sankey-label-value');
        valueLabel.textContent = this.formatShortCurrency(node.amount);
        nodesGroup.appendChild(valueLabel);
      }
    });

    svg.appendChild(nodesGroup);

    // Clear container and add SVG
    container.innerHTML = '';
    container.appendChild(svg);

    // Add legend
    const legend = document.createElement('div');
    legend.className = 'sankey-legend';
    legend.innerHTML = `
      <div class="sankey-legend-section">
        <span class="sankey-legend-title">Contributions</span>
        ${sourceNodes.map((s, i) => `
          <div class="sankey-legend-item">
            <span class="sankey-legend-color" style="background: ${s.color || this.colors[i % this.colors.length]}"></span>
            ${Utils.escapeHtml(s.name)}
          </div>
        `).join('')}
      </div>
    `;
    container.appendChild(legend);
  }
};
