import React, { useState } from 'react';

export default function CVBuilder() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [summary, setSummary] = useState('');

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    alert(`Dit CV er endnu ikke sendt, ${name}!`);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 max-w-lg">
      {/* Navn */}
      <div>
        <label className="block text-sm font-medium mb-1" htmlFor="name">Navn</label>
        <input
          id="name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full border p-2 rounded"
          placeholder="Skriv dit navn"
        />
      </div>
      {/* Email */}
      <div>
        <label className="block text-sm font-medium mb-1" htmlFor="email">Email</label>
        <input
          id="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full border p-2 rounded"
          placeholder="Skriv din email"
        />
      </div>
      {/* Resumé */}
      <div>
        <label className="block text-sm font-medium mb-1" htmlFor="summary">Resumé</label>
        <textarea
          id="summary"
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          className="w-full border p-2 rounded"
          placeholder="Skriv et kort resumé om dig selv"
        />
      </div>
      <button type="submit" className="bg-primary text-white py-2 px-4 rounded">
        Opret CV
      </button>
    </form>
  );
}
