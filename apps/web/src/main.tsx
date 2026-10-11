import React, { Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router';
import { SWRConfig } from 'swr';
import { api } from './lib/api';
import { Pending } from './components/ui';
import './styles.css';
const Auth = lazy(() => import('./pages/Auth'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const ProductEditor = lazy(() => import('./pages/ProductEditor'));
const Access = lazy(() => import('./pages/Access'));
const Checkout = lazy(() => import('./pages/Checkout'));
const BuyerOrder = lazy(() => import('./pages/BuyerOrder'));
const Orders = lazy(() => import('./pages/Orders'));
const PlatformSettings = lazy(() => import('./pages/PlatformSettings'));
const Settings = lazy(() => import('./pages/Settings'));
createRoot(document.getElementById('root')!).render(<React.StrictMode><SWRConfig value={{ fetcher: api, shouldRetryOnError: false }}><BrowserRouter><Suspense fallback={<Pending/>}><Routes>
  <Route path="/checkout/:id" element={<Checkout/>}/>
  <Route path="/pedido" element={<BuyerOrder/>}/>
  <Route path="/pedidos" element={<Orders/>}/>
  <Route path="/admin/configuracoes" element={<PlatformSettings/>}/>
  <Route path="/" element={<Dashboard/>}/>
  <Route path="/configuracoes" element={<Settings/>}/>
  <Route path="/entrar" element={<Auth/>}/>
  <Route path="/cadastro" element={<Auth register/>}/>
  <Route path="/produtos/novo" element={<ProductEditor/>}/>
  <Route path="/produtos/:id" element={<ProductEditor/>}/>
  <Route path="/verificar-email" element={<Access/>}/>
  <Route path="/redefinir-senha" element={<Access reset/>}/>
  <Route path="*" element={<main className="narrow"><h1>Esta página não está aqui.</h1><a href="/">Voltar para a nostore</a></main>}/>
</Routes></Suspense></BrowserRouter></SWRConfig></React.StrictMode>);
