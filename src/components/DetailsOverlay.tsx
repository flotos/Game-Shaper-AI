import React from 'react';
import { Node } from '../models/Node';

interface DetailsOverlayProps {
  isCollapsed: boolean;
  toggleCollapse: () => void;
  lastNodeEdition: Partial<Node>[];
  nodes: Partial<Node>[];
}

const renderTable = (title: string, in_data: Partial<Node>[]) => {
  if (!in_data || !in_data.length) return null;

  const data = in_data.map(d => {
    return Object.keys(d).reduce((acc, key) => {
      if (key !== 'image') {
        acc[key] = d[key];
      }
      return acc;
    }, {});
  });

  const keys = Object.keys(Array.isArray(data) ? data[0] : data);
  return (
    <div className="mb-4">
      <div className="font-bold text-lg mb-2">{title}</div>
      <table className="table-auto text-sm w-full">
        <thead>
          <tr className="bg-gray-700 text-white">
            <th className="px-4 py-2">Property</th>
            {Array.isArray(data) ? data.map((node, index) => (
              <th key={index} className="px-4 py-2">{node.name || index}</th>
            )) : (
              <th className="px-4 py-2">Value</th>
            )}
          </tr>
        </thead>
        <tbody>
          {keys.map(key => (
            <tr key={key} className="bg-gray-800 text-gray-200">
              <td className="border px-4 py-2 font-bold">{key}</td>
              {Array.isArray(data) ? data.map((item, index) => (
                <td key={index} className="border px-4 py-2">{JSON.stringify(item[key], null, 2)}</td>
              )) : (
                <td className="border px-4 py-2">{JSON.stringify(data[key], null, 2)}</td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

const DetailsOverlay: React.FC<DetailsOverlayProps> = ({ isCollapsed, toggleCollapse, lastNodeEdition, nodes }) => {
  return (
    !isCollapsed && (
      <div className="fixed top-0 left-0 w-full h-full bg-black bg-opacity-75 z-20 overflow-y-auto p-4 text-white">
        <button onClick={toggleCollapse} className="text-white absolute top-3 right-3 text-lg font-bold">× Close</button>
        <div className="text-xl font-bold mb-2">Details</div>
        {renderTable("Last Node Edition", lastNodeEdition || {})}
        {renderTable("Current Nodes", nodes)}
      </div>
    )
  );
};

export default DetailsOverlay;
