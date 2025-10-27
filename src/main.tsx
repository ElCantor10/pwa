import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import React from 'react';
import ReactDOM from 'react-dom/client';
import Login from './pages/login';
import Dashboard from "./pages/Dashboard";
import ProtectedRoute from './routes/ProtectedRoute';
import Register from './pages/Register'; 
import "./index.css";

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        {/* pública */}
        <Route path="/" element={<Login />} />
         <Route path="/register" element={<Register />} /> 
        {/* Protegida */}
        <Route 
          path="/dashboard/*" 
          element={
            <ProtectedRoute>
              <Dashboard/>
            </ProtectedRoute>
          } 
        />

        <Route path="*" element={<Navigate to="/" replace />} />  
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);